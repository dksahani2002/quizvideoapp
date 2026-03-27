#!/usr/bin/env bash
# Build the container, push to ECR, deploy the SAM stack.
# Prerequisites: AWS CLI v2, Docker, SAM CLI, aws configure, MongoDB Atlas (or reachable Mongo).
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
REPO_NAME="${ECR_REPO_NAME:-mcq-shorts-agent}"
STACK_NAME="${SAM_STACK_NAME:-mcq-shorts-agent}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

if ! aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${REGION}" &>/dev/null; then
  aws ecr create-repository --repository-name "${REPO_NAME}" --region "${REGION}" >/dev/null
  echo "Created ECR repository ${REPO_NAME}"
fi

aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# Build a single-arch image (Lambda does not accept OCI index/manifest lists).
# `--load` ensures the result is a local Docker image, then `docker push` uploads it.
docker buildx build --platform linux/amd64 --provenance=false --load -f Dockerfile.lambda -t "${REPO_NAME}:latest" .

docker tag "${REPO_NAME}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"

echo ""
echo "Image pushed: ${ECR_URI}:latest"
echo "Deploy with SAM (set secrets — do not commit them):"
echo ""
echo "  sam deploy --stack-name ${STACK_NAME} --capabilities CAPABILITY_IAM --region ${REGION} \\"
echo "    --parameter-overrides \\"
echo "      ContainerImageUri=${ECR_URI}:latest \\"
echo "      MongoUri='YOUR_MONGODB_URI' \\"
echo "      JwtSecret='YOUR_32_PLUS_CHAR_RANDOM_SECRET' \\"
echo "      CorsOrigin='https://your-frontend-origin' \\"
echo "      OpenAiApiKey=''"
