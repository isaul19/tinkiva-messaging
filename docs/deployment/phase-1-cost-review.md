# Phase 1 pre-deployment cost review

Review date: 2026-07-25  
Target: AWS account `160358212333`, `us-east-1`, stage `dev`

Current account checks:

- Existing CloudWatch metric alarms in `us-east-1`: 0.
- Existing Secrets Manager secrets in `us-east-1`: 0.
- Shared Serverless artifact bucket objects: 0.

Expected incremental idle cost:

- Two Secrets Manager secrets: approximately USD 0.80/month.
- Five standard-resolution alarm metrics: expected to fit within the account-level allowance of ten
  standard alarm metrics while the current count remains zero.
- DynamoDB on-demand throughput: USD 0 at zero requests; storage is usage-based.
- SQS: no minimum fee; request charges apply after the applicable free allowance.
- S3, Lambda, API Gateway, SNS, and CloudWatch Logs: usage-based.

The practical idle estimate is approximately USD 0.80/month plus taxes and any small storage,
request, or log usage. This is not a spending cap. Traffic, message size, media retention, log
volume, provider API usage, and future secrets can increase the bill.

No AWS Budget is included in the application stack yet. A budget is account-level governance and
needs a monthly threshold and notification destination before it can be added safely.
