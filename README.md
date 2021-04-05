# AppPack Build GitHub Action

This action triggers an [AppPack](https://apppack.io) app's CodeBuild Project build which then kicks off a full release and deployment at AWS. AWS credentials are required to make the necessary API calls.

The action is designed to be used with `apppackio/build-action` and `apppackio/upload-artifacts-action`. The former will upload a container image in the correct format and the latter will upload build artifacts to a known location at S3.

## Inputs

### `appname`

**Required** Name of the AppPack app

## Outputs

### `build_number`

CodeBuild build number of deploy

### `build_arn`

CodeBuild build ARN of deploy

## Example usage

```yaml
- name: AppPack Deploy
  uses: apppackio/deploy-action@v1
  with:
    appname: my-app
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_REGION: us-east-1
```
