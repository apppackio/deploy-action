# AppPack Build GitHub Action

This action triggers an [AppPack](https://apppack.io) app's CodeBuild Project build which then kicks off a full release and deployment at AWS. AWS credentials are required to make the necessary API calls. It does the following:

* Uploads a container image to the correct location. The image must exist locally in the GitHub Actions Docker daemon.
* Generates a `commit.txt` file for the current commit. You should include the `actions/checkout` step in your workflow to ensure the commit is available.
* Uploads the following files as build artifacts to S3:
  * `build.log` (optional)
  * `test.log` (optional)
  * `commit.txt` (required)
  * `apppack.toml` (required)

Your build process is responsible for generating these files (with the exception of `commit.txt`).

## Inputs

### `appname`

**Required** Name of the AppPack app

### `image`

**Required** Name of local Docker image to deploy

## Outputs

### `build_number`

CodeBuild build number of deploy

### `build_arn`

CodeBuild build ARN of deploy

## Example usage

```yaml
- uses: aws-actions/configure-aws-credentials@v2
  with:
    role-to-assume: ${{ env.AWS_ROLE_ARN }}
    aws-region: ${{ env.AWS_REGION }}
- name: AppPack Deploy
  uses: apppackio/deploy-action@v1
  with:
    appname: my-app
    image: my-app:latest
```
