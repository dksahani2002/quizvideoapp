#!/bin/bash

# AWS ECR and ECS Deployment Setup for MCQ Shorts Agent
set -e

# Configuration
AWS_PROFILE_ARG=""
if [ -n "$1" ]; then
  AWS_PROFILE="$1"
  shift
fi
if [ -n "$AWS_PROFILE" ]; then
  AWS_PROFILE_ARG="--profile $AWS_PROFILE"
fi

AWS_REGION=${AWS_REGION:-us-east-1}

echo "Checking AWS credentials..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity $AWS_PROFILE_ARG --query Account --output text 2>/dev/null || true)
if [ -z "$AWS_ACCOUNT_ID" ]; then
  echo "Error: Unable to locate AWS credentials. Run: aws configure"
  exit 1
fi

ECR_REPOSITORY_NAME="mcq-shorts-agent"
ECS_CLUSTER_NAME="mcq-shorts-cluster"
ECS_SERVICE_NAME="mcq-shorts-service"
ECS_TASK_FAMILY="mcq-shorts-task"
IMAGE_TAG="latest"

echo "🚀 Starting MCQ Shorts Agent AWS Deployment Setup..."
echo "AWS Region: $AWS_REGION"
echo "AWS Account ID: $AWS_ACCOUNT_ID"

# Step 1: Create ECR Repository
echo ""
echo "📦 Step 1: Creating ECR Repository..."
ECR_REPO=$(aws ecr describe-repositories $AWS_PROFILE_ARG \
  --repository-names $ECR_REPOSITORY_NAME \
  --region $AWS_REGION 2>/dev/null || true)

if [ -z "$ECR_REPO" ]; then
  echo "Creating repository: $ECR_REPOSITORY_NAME"
  aws ecr create-repository $AWS_PROFILE_ARG \
    --repository-name $ECR_REPOSITORY_NAME \
    --region $AWS_REGION \
    --encryption-configuration encryptionType=AES256 >/dev/null
  echo "✅ ECR Repository created"
else
  echo "✅ ECR Repository already exists"
fi

ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
ECR_REGISTRY="$ECR_URI/$ECR_REPOSITORY_NAME"

# Step 2: Configure Docker for ECR
echo ""
echo "🔐 Step 2: Configuring Docker for ECR..."
aws ecr get-login-password $AWS_PROFILE_ARG --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ECR_URI >/dev/null 2>&1
echo "✅ Docker authenticated with ECR"

# Step 3: Build Docker Image
echo ""
echo "🔨 Step 3: Building Docker Image..."
docker build -t $ECR_REPOSITORY_NAME:$IMAGE_TAG \
  --build-arg NODE_ENV=production \
  .
echo "✅ Docker image built successfully"

# Step 4: Tag Image for ECR
echo ""
echo "🏷️  Step 4: Tagging Image for ECR..."
docker tag $ECR_REPOSITORY_NAME:$IMAGE_TAG $ECR_REGISTRY:$IMAGE_TAG
docker tag $ECR_REPOSITORY_NAME:$IMAGE_TAG $ECR_REGISTRY:$(date +%Y%m%d-%H%M%S)
echo "✅ Image tagged for ECR"

# Step 5: Push to ECR
echo ""
echo "📤 Step 5: Pushing Image to ECR..."
docker push $ECR_REGISTRY:$IMAGE_TAG >/dev/null 2>&1
echo "✅ Image pushed to ECR"

# Step 6: Create Secrets in AWS Secrets Manager
echo ""
echo "🔑 Step 6: Setting up AWS Secrets Manager..."
echo "Please provide the following values (or press Enter to skip):"

read -p "OpenAI API Key: " OPENAI_API_KEY
read -p "YouTube Client ID: " YT_CLIENT_ID
read -p "YouTube Client Secret: " YT_CLIENT_SECRET
read -p "YouTube Refresh Token: " YT_REFRESH_TOKEN
read -p "Instagram Username: " IG_USERNAME
read -sp "Instagram Password: " IG_PASSWORD
echo ""

if [ -n "$OPENAI_API_KEY" ]; then
  aws secretsmanager create-secret $AWS_PROFILE_ARG \
    --name mcq-shorts/openai-api-key \
    --secret-string "$OPENAI_API_KEY" \
    --region $AWS_REGION 2>/dev/null || \
  aws secretsmanager update-secret $AWS_PROFILE_ARG \
    --secret-id mcq-shorts/openai-api-key \
    --secret-string "$OPENAI_API_KEY" \
    --region $AWS_REGION >/dev/null
  echo "✅ OpenAI API Key stored"
fi

if [ -n "$YT_CLIENT_ID" ]; then
  aws secretsmanager create-secret $AWS_PROFILE_ARG \
    --name mcq-shorts/youtube-client-id \
    --secret-string "$YT_CLIENT_ID" \
    --region $AWS_REGION 2>/dev/null || \
  aws secretsmanager update-secret $AWS_PROFILE_ARG \
    --secret-id mcq-shorts/youtube-client-id \
    --secret-string "$YT_CLIENT_ID" \
    --region $AWS_REGION >/dev/null
  echo "✅ YouTube Client ID stored"
fi

if [ -n "$YT_CLIENT_SECRET" ]; then
  aws secretsmanager create-secret $AWS_PROFILE_ARG \
    --name mcq-shorts/youtube-client-secret \
    --secret-string "$YT_CLIENT_SECRET" \
    --region $AWS_REGION 2>/dev/null || \
  aws secretsmanager update-secret $AWS_PROFILE_ARG \
    --secret-id mcq-shorts/youtube-client-secret \
    --secret-string "$YT_CLIENT_SECRET" \
    --region $AWS_REGION >/dev/null
  echo "✅ YouTube Client Secret stored"
fi

if [ -n "$YT_REFRESH_TOKEN" ]; then
  aws secretsmanager create-secret $AWS_PROFILE_ARG \
    --name mcq-shorts/youtube-refresh-token \
    --secret-string "$YT_REFRESH_TOKEN" \
    --region $AWS_REGION 2>/dev/null || \
  aws secretsmanager update-secret $AWS_PROFILE_ARG \
    --secret-id mcq-shorts/youtube-refresh-token \
    --secret-string "$YT_REFRESH_TOKEN" \
    --region $AWS_REGION >/dev/null
  echo "✅ YouTube Refresh Token stored"
fi

if [ -n "$IG_USERNAME" ]; then
  aws secretsmanager create-secret $AWS_PROFILE_ARG \
    --name mcq-shorts/instagram-username \
    --secret-string "$IG_USERNAME" \
    --region $AWS_REGION 2>/dev/null || \
  aws secretsmanager update-secret $AWS_PROFILE_ARG \
    --secret-id mcq-shorts/instagram-username \
    --secret-string "$IG_USERNAME" \
    --region $AWS_REGION >/dev/null
  echo "✅ Instagram Username stored"
fi

if [ -n "$IG_PASSWORD" ]; then
  aws secretsmanager create-secret $AWS_PROFILE_ARG \
    --name mcq-shorts/instagram-password \
    --secret-string "$IG_PASSWORD" \
    --region $AWS_REGION 2>/dev/null || \
  aws secretsmanager update-secret $AWS_PROFILE_ARG \
    --secret-id mcq-shorts/instagram-password \
    --secret-string "$IG_PASSWORD" \
    --region $AWS_REGION >/dev/null
  echo "✅ Instagram Password stored"
fi

# Step 7: Create CloudWatch Log Group
echo ""
echo "📊 Step 7: Creating CloudWatch Log Group..."
aws logs create-log-group $AWS_PROFILE_ARG \
  --log-group-name /ecs/mcq-shorts-api \
  --region $AWS_REGION 2>/dev/null || true
echo "✅ CloudWatch Log Group ready"

# Step 8: Create ECS Cluster
echo ""
echo "🎯 Step 8: Creating ECS Cluster..."
aws ecs create-cluster $AWS_PROFILE_ARG \
  --cluster-name $ECS_CLUSTER_NAME \
  --region $AWS_REGION 2>/dev/null || true
echo "✅ ECS Cluster ready"

# Display Summary
echo ""
echo "=========================================="
echo "✅ AWS Setup Complete!"
echo "=========================================="
echo ""
echo "📋 Summary:"
echo "  ECR Registry: $ECR_REGISTRY"
echo "  ECR Repository: $ECR_REPOSITORY_NAME"
echo "  ECS Cluster: $ECS_CLUSTER_NAME"
echo "  AWS Region: $AWS_REGION"
echo ""
echo "📝 Next Steps:"
echo "  1. Update ecs-task-definition.json with your values:"
echo "     sed -i '' 's/ACCOUNT_ID/$AWS_ACCOUNT_ID/g' ecs-task-definition.json"
echo "     sed -i '' 's/REGION/$AWS_REGION/g' ecs-task-definition.json"
echo ""
echo "  2. Register the task definition:"
echo "     aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json --region $AWS_REGION"
echo ""
echo "  3. Set up networking and create service:"
echo "     Follow the AWS_DEPLOYMENT_GUIDE.md for full setup"
echo ""
echo "  4. View logs:"
echo "     aws logs tail /ecs/mcq-shorts-api --follow --region $AWS_REGION"
echo ""
