# ADR 0002: One modular CloudFormation stack per environment

- Status: Accepted
- Date: 2026-07-25

## Context

The messaging gateway includes Lambda functions and tightly related API Gateway, DynamoDB, SQS, S3,
Secrets Manager, SNS, CloudWatch, and IAM resources. Operators need to reproduce an environment
without recreating resources manually.

## Decision

Each environment is one Serverless Framework service and one CloudFormation stack:

```text
tinkiva-messaging-gateway-{stage}
```

The `serverless.yml` entry point composes resource modules from `infrastructure/serverless/*.yml`.
Serverless Framework packages the modules into one generated CloudFormation template.

Runtime IAM roles are defined per Lambda function. A role is created only when its function exists
and its required operations are known.

## Consequences

- Deployments, rollbacks, and change sets have one transactional boundary per environment.
- Resource definitions stay separated by concern without creating cross-stack exports.
- A failed update can roll back the whole environment.
- Resources with persistent data require additional care before stack removal.
- Splitting high-volume data resources into separate stacks remains possible if deployment
  independence becomes necessary.
