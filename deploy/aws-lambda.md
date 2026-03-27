# Deploy on AWS Lambda

This app uses **two Lambda functions** (same container image, different handler):

1. **API** — Express via `@codegenie/serverless-express`, HTTP API (API Gateway v2), serves the built SPA and `/api/*`.
2. **Video worker** — runs `runVideoJob` (ffmpeg, TTS, mux). Invoked asynchronously when a quiz video is queued.

Rendered videos are uploaded to **S3** (`S3_OUTPUT_BUCKET` on the worker) because the API and worker Lambdas do **not** share `/tmp`. The API issues **presigned GET** URLs for playback and download.

## Prerequisites

- **MongoDB** reachable from AWS (e.g. MongoDB Atlas; allow `0.0.0.0/0` or AWS IP ranges, or use a VPC + VPC peering / PrivateLink).
- **AWS CLI**, **Docker**, **AWS SAM CLI** (`brew install aws-sam-cli` on macOS).
- **IAM** user/role with ECR push, CloudFormation, Lambda, API Gateway, S3.

## 1. Build and push the image

From the repo root:

```bash
chmod +x scripts/deploy-lambda.sh
./scripts/deploy-lambda.sh
```

Or manually:

```bash
aws ecr create-repository --repository-name mcq-shorts-agent --region "$AWS_REGION"   # once
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com"

docker build --platform linux/amd64 -f Dockerfile.lambda -t mcq-shorts-agent:latest .
docker tag mcq-shorts-agent:latest "$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/mcq-shorts-agent:latest"
docker push "$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/mcq-shorts-agent:latest"
```

## 2. Deploy the stack

```bash
sam deploy --guided
```

When prompted:

- **Stack name**: e.g. `mcq-shorts-agent`
- **Region**: your region
- **Parameter ContainerImageUri**: the ECR URI from step 1 (must end with `:latest` or a tag you pushed)
- **MongoUri**: full MongoDB connection string
- **JwtSecret**: random string, **at least 32 characters**
- **CorsOrigin**: your browser origin (e.g. `https://d123.cloudfront.net`) or `*` for testing only
- **OpenAiApiKey**: optional default; users can still store keys in the app

Capabilities: **CAPABILITY_IAM**.

## 3. After deploy

- **HttpApiUrl** (stack output) is the base URL for the SPA and API (same origin). Open it in a browser.
- **OutputBucketName** holds MP4s (private). Access is via presigned URLs from the API.
- Ensure **MongoDB Atlas** network access allows connections from Lambda (Atlas IP allowlist or VPC setup).

## Limits and notes

- **Worker timeout** is 15 minutes; very long quizzes may need tuning or ECS instead.
- **API Gateway** has payload and timeout limits; large uploads use the existing JSON routes with increased body size where configured.
- **Rate limiting** (`express-rate-limit`) is per Lambda instance, not global—use API Gateway throttling or Redis if you need strict limits.
- **Secrets**: prefer AWS Secrets Manager or SSM Parameter Store for production instead of plain CloudFormation parameters.

## Local development (unchanged)

```bash
npm run dev
```

Do **not** set `VIDEO_WORKER_FUNCTION_NAME` locally unless testing Lambda invokes; by default the server runs `runVideoJob` in-process.
