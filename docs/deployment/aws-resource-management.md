# AWS resource management

## Policy

All application resources are declared in `serverless.yml` and materialized through the
CloudFormation stack managed by Serverless Framework. Console-created resources are not part of the
normal deployment path.

The initial naming convention is:

```text
service: tinkiva-messaging-gateway
stack: tinkiva-messaging-gateway-{stage}
region: us-east-1
stages: dev, prod
```

Every supported resource receives these tags where AWS permits them:

```text
Project=tinkiva-messaging
Service=messaging-gateway
Stage={stage}
ManagedBy=serverless-framework
```

## Reproducibility requirements

Each infrastructure change must include:

1. The CloudFormation/Serverless declaration.
2. Configuration documentation without secret values.
3. Tests or package validation where practical.
4. An entry in `deployment-history.md` after an actual deployment.
5. A rollback or removal note for operationally significant changes.

Secrets are bootstrapped through an explicit runbook and referenced by ARN or stable parameter name.
Secret values are never committed.

## Permissions

The deployment identity currently has administrative access. Runtime functions will not use that
identity or a shared broad role. Each Lambda receives a dedicated least-privilege role based on its
actual DynamoDB, SQS, S3, Secrets Manager, and logging operations.
