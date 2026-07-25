# Deploy the development stage

This runbook is intentionally incomplete until the Phase 1 resources and Serverless authentication
are configured. Do not use it for production.

## Preconditions

- Node.js and pnpm versions satisfy `package.json`.
- AWS CLI resolves to the intended account and region.
- Serverless Framework v4 authentication is configured outside source control.
- `pnpm verify` succeeds.
- The planned CloudFormation changes have been reviewed.

## Package without deployment

```powershell
pnpm package
```

Inspect `.serverless/cloudformation-template-update-stack.json` before the first deployment.

## Deployment

The deployment command will be:

```powershell
pnpm exec serverless deploy --stage dev --region us-east-1
```

Do not run it until the change set, resource cost, and account identity are confirmed.

## Verification

After deployment:

1. Capture CloudFormation outputs.
2. Call `GET /health`.
3. Confirm that the response contains only `service` and `status`.
4. Confirm CloudWatch logs contain a correlation identifier and no request secrets.
5. Record the result in `docs/deployment/deployment-history.md`.
