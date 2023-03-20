const core = require("@actions/core");
const exec = require("@actions/exec");
const github = require("@actions/github");
const tc = require("@actions/tool-cache");
const yaml = require("js-yaml");
const {
  CodeBuildClient,
  BatchGetProjectsCommand,
  StartBuildCommand,
} = require("@aws-sdk/client-codebuild");
const {
  ECRClient,
  GetAuthorizationTokenCommand,
} = require("@aws-sdk/client-ecr");

const codebuildImage = "public.ecr.aws/aws-cli/aws-cli:latest";
const craneDownloadPath =
  "https://github.com/google/go-containerregistry/releases/download/v0.4.1/go-containerregistry_Linux_x86_64.tar.gz";

async function main() {
  if (process.platform !== "linux") {
    core.setFailed("AppPack deploy can only run on Linux platforms");
  }
  if ("AWS_DEFAULT_REGION" in process.env && !("AWS_REGION" in process.env)) {
    process.env.AWS_REGION = process.env.AWS_DEFAULT_REGION;
  }
  const codebuild = new CodeBuildClient();
  let params = { names: [core.getInput("appname")] };
  let command = new BatchGetProjectsCommand(params);
  let data = await codebuild.send(command);
  const project = data.projects[0];
  const dockerRepo = project.environment.environmentVariables.find(
    (e) => e.name === "DOCKER_REPO"
  ).value;
  const dockerRegistry = dockerRepo.split("/")[0];
  const artifactsBucket = project.artifacts.location;
  const buildArtifacts = yaml.load(project.source.buildspec).artifacts.files;
  core.startGroup("Downloading crane");
  const craneArchive = await tc.downloadTool(craneDownloadPath);
  await tc.extractTar(craneArchive, "/tmp/crane");
  core.endGroup();

  // trigger deploy via codebuild
  core.startGroup("Triggering deploy");
  const buildspec = {
    version: 0.2,
    artifacts: {
      files: buildArtifacts,
      name: "$CODEBUILD_BUILD_NUMBER",
    },
    phases: {
      build: {
        commands: `aws s3 cp --recursive s3://${artifactsBucket}/external-${github.context.runNumber}/ .`,
      },
    },
  };
  params = {
    projectName: core.getInput("appname", { required: true }),
    sourceVersion: github.context.ref,
    gitCloneDepthOverride: 1,
    buildspecOverride: JSON.stringify(buildspec),
    imageOverride: codebuildImage,
  };
  command = new StartBuildCommand(params);
  data = await codebuild.send(command);
  const buildNumber = data.build.buildNumber;
  core.info(`Started build #${buildNumber}`);
  core.info(data.build.arn);
  core.setOutput("build_number", buildNumber);
  core.setOutput("build_arn", data.build.arn);
  core.endGroup();

  // tag docker image
  core.startGroup(`Tagging image 'build-${buildNumber}'`);
  const ecr = new ECRClient();
  command = new GetAuthorizationTokenCommand({});
  data = await ecr.send(command);
  core.info("Logging into ECR repo");
  const [username, password] = Buffer.from(
    data.authorizationData[0].authorizationToken,
    "base64"
  )
    .toString()
    .split(":");
  await exec.exec(
    '"/tmp/crane/crane"',
    [
      "auth",
      "login",
      "--username",
      username,
      "--password-stdin",
      dockerRegistry,
    ],
    {
      input: Buffer.from(password),
    }
  );
  core.info("Tagging image");
  await exec.exec('"/tmp/crane/crane"', [
    "tag",
    `${dockerRepo}:${github.context.sha}`,
    `build-${buildNumber}`,
  ]);
  core.endGroup();
}

if (require.main === module) {
  main().catch((error) => {
    core.setFailed(error.message);
  });
}
