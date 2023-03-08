const core = require("@actions/core");
const github = require("@actions/github");
const { exec } = require("@actions/exec");
const fs = require('fs');
const { downloadTool, extractTar } = require("@actions/tool-cache");
const { load } = require("js-yaml");
const { CodeBuildClient, BatchGetProjectsCommand, StartBuildCommand } = require("@aws-sdk/client-codebuild");
const { ECRClient, GetAuthorizationTokenCommand } = require("@aws-sdk/client-ecr");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const { startGroup, getInput, info, setOutput, warning, setFailed, endGroup } = core;
const { context } = github;


const craneDownloadPath =
  "https://github.com/google/go-containerregistry/releases/download/v0.13.0/go-containerregistry_Linux_x86_64.tar.gz";
const codebuildImage = "public.ecr.aws/aws-cli/aws-cli:latest";

async function commitTxt() {
  // exec `git log -n1` and save to `commit.txt`
  await exec("git", ["log", "-n1"], {
    listeners: {
      stdout: (data) => {
        fs.writeFileSync("./commit.txt", data.toString());
      },
    },
  });
}

async function codebuildProject() {
  const codebuild = new CodeBuildClient({});
  const params = { names: [getInput("appname")] };
  const command = new BatchGetProjectsCommand(params);
  const data = await codebuild.send(command);
  return data.projects[0];
}

async function uploadArtifacts(artifactsBucket, files) {
  info("Uploading artifacts");
  const prefix = `external-${context.runNumber}/`;
  setOutput("artifacts_bucket", artifactsBucket);
  setOutput("artifacts_prefix", prefix);
  const s3 = new S3Client({});
  files.forEach((file) => {
    fs.readFile(`./${file}`, "utf8", function (err, contents) {
      if (err) {
        if (err.code === "ENOENT") {
          // this is a buildpack artifact which we don't expect BYOB to upload
          if (file !== "metadata.toml") {
            warning(
              `${file} does not exist. It must be uploaded to S3 for a deploy to succeed.`
            );
          }
        } else {
          throw err;
        }
      } else {
        const command = new PutObjectCommand({
          Bucket: artifactsBucket,
          Key: `${prefix}${file}`,
          Body: contents,
        });
        info(`  * ${file}`);
        s3.send(command).catch((error) => {
          setFailed(error.message);
        });
      }
    });
  });
  endGroup();
}

async function downloadCrane() {
  info("Downloading crane");
  const craneArchive = await downloadTool(craneDownloadPath);
  await extractTar(craneArchive, "/tmp/crane");
}

async function startBuild(artifactsBucket, buildArtifacts) {
  // trigger deploy via codebuild
  const buildspec = {
    version: 0.2,
    artifacts: {
      files: buildArtifacts,
      name: "$CODEBUILD_BUILD_NUMBER",
    },
    phases: {
      build: {
        commands: `aws s3 cp --recursive s3://${artifactsBucket}/external-${context.runNumber}/ .`,
      },
    },
  };
  const params = {
    projectName: getInput("appname", { required: true }),
    sourceVersion: context.ref,
    gitCloneDepthOverride: 1,
    imageOverride: codebuildImage,
    buildspecOverride: JSON.stringify(buildspec),
  };
  const codebuild = new CodeBuildClient({});
  const command = new StartBuildCommand(params);
  const data = await codebuild.send(command);
  const buildNumber = data.build.buildNumber;
  info(`Started build #${buildNumber}`);
  info(data.build.arn);
  setOutput("build_number", buildNumber);
  setOutput("build_arn", data.build.arn);
  return buildNumber;
}

async function pushImages(dockerRepo, buildNumber) {
  // tag docker image
  startGroup(`Pushing images to ${dockerRepo}`);
  const image = `${dockerRepo}:${context.sha}`;
  await exec("docker", [
    "tag",
    getInput("image", { required: true }),
    image,
  ]);
  const dockerRegistry = dockerRepo.split("/")[0];
  const ecr = new ECRClient({});
  const command = new GetAuthorizationTokenCommand({});
  const data = await ecr.send(command);
  info("Logging into ECR repo");
  const [username, password] = Buffer.from(
    data.authorizationData[0].authorizationToken,
    "base64"
  )
    .toString()
    .split(":");
  await exec(
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
  await exec("docker", ["push", image]);
  info("Tagging image");
  await exec('"/tmp/crane/crane"', ["tag", image, `build-${buildNumber}`]);
  endGroup();
}

async function main() {
  if (process.platform !== "linux") {
    setFailed("AppPack deploy can only run on Linux platforms");
  }
  if ("AWS_DEFAULT_REGION" in process.env && !("AWS_REGION" in process.env)) {
    process.env.AWS_REGION = process.env.AWS_DEFAULT_REGION;
  }
  const [project] = await Promise.all([
    codebuildProject(),
    commitTxt(),
    downloadCrane(),
  ]);
  const dockerRepo = project.environment.environmentVariables.find(
    (e) => e.name === "DOCKER_REPO"
  ).value;
  const artifactsBucket = project.artifacts.location;
  const buildArtifacts = load(project.source.buildspec).artifacts.files;
  await uploadArtifacts(artifactsBucket, buildArtifacts);
  const buildNumber = await startBuild(artifactsBucket, buildArtifacts);
  await pushImages(dockerRepo, buildNumber);
}

if (require.main === module) {
  main().catch((error) => {
    setFailed(error.message);
  });
}
