#!/usr/bin/env bash
# Create one S3 bucket for user uploads + story outputs (optional).
# Usage:
#   export AWS_REGION=ap-south-1
#   export BUCKET_NAME=my-app-media
#   export CORS_ORIGIN=http://localhost:5173
#   bash scripts/create-s3-user-uploads-bucket.sh
set -euo pipefail

BUCKET_NAME="${BUCKET_NAME:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:5173}"

if [[ -z "$BUCKET_NAME" ]]; then
  echo "Set BUCKET_NAME (e.g. export BUCKET_NAME=my-app-media)"
  exit 1
fi

aws s3api create-bucket \
  --bucket "$BUCKET_NAME" \
  --region "$AWS_REGION" \
  --create-bucket-configuration "LocationConstraint=${AWS_REGION}" \
  2>/dev/null || true

aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
cat >"$TMP" <<EOF
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "HEAD"],
      "AllowedOrigins": ["${CORS_ORIGIN}"],
      "ExposeHeaders": ["ETag", "Content-Length"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF

aws s3api put-bucket-cors --bucket "$BUCKET_NAME" --cors-configuration "file://$TMP"

echo "Bucket ready: $BUCKET_NAME"
echo "Add to .env:"
echo "  S3_REGION=$AWS_REGION"
echo "  S3_USER_UPLOADS_BUCKET=$BUCKET_NAME"
echo "  S3_OUTPUT_BUCKET=$BUCKET_NAME"
echo "IAM: grant the API role s3:PutObject, s3:GetObject, s3:HeadObject on arn:aws:s3:::${BUCKET_NAME}/*"
