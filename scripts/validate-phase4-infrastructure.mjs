import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const templatePath = resolve(
  process.cwd(),
  ".serverless",
  "cloudformation-template-update-stack.json",
);
const template = JSON.parse(readFileSync(templatePath, "utf8"));
const resources = template.Resources ?? {};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const resource = (logicalId, expectedType) => {
  const value = resources[logicalId];
  assert(value !== undefined, `Missing CloudFormation resource: ${logicalId}`);
  assert(
    value.Type === expectedType,
    `${logicalId} must be ${expectedType}, received ${String(value.Type)}`,
  );

  return value;
};

const actionsFor = (role) =>
  role.Properties.Policies.flatMap((policy) =>
    policy.PolicyDocument.Statement.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    ),
  );

const assertNoWildcardResources = (role, roleName) => {
  for (const policy of role.Properties.Policies) {
    for (const statement of policy.PolicyDocument.Statement) {
      const iamResources = Array.isArray(statement.Resource)
        ? statement.Resource
        : [statement.Resource];
      assert(!iamResources.includes("*"), `${roleName} must not contain wildcard resources`);
    }
  }
};

resource("WhatsappWebhookLambdaFunction", "AWS::Lambda::Function");
const webhookRole = resource("WhatsappWebhookLambdaRole", "AWS::IAM::Role");
const webhookActions = actionsFor(webhookRole);

for (const action of ["dynamodb:GetItem", "kms:Decrypt", "sqs:SendMessage"]) {
  assert(webhookActions.includes(action), `WhatsappWebhookLambdaRole must allow ${action}`);
}
assertNoWildcardResources(webhookRole, "WhatsappWebhookLambdaRole");

resource("WhatsappSenderLambdaFunction", "AWS::Lambda::Function");
const senderRole = resource("WhatsappSenderLambdaRole", "AWS::IAM::Role");
const senderActions = actionsFor(senderRole);

for (const action of [
  "sqs:ReceiveMessage",
  "sqs:DeleteMessage",
  "sqs:GetQueueAttributes",
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:TransactWriteItems",
  "dynamodb:UpdateItem",
  "kms:Decrypt",
]) {
  assert(senderActions.includes(action), `WhatsappSenderLambdaRole must allow ${action}`);
}
assertNoWildcardResources(senderRole, "WhatsappSenderLambdaRole");

const senderMappings = Object.values(resources).filter(
  (value) =>
    value.Type === "AWS::Lambda::EventSourceMapping" &&
    value.Properties?.FunctionName?.["Fn::GetAtt"]?.[0] === "WhatsappSenderLambdaFunction",
);
assert(
  senderMappings.length === 1,
  "WhatsappSender must have exactly one SQS event source mapping",
);
assert(
  senderMappings[0].Properties.EventSourceArn?.["Fn::GetAtt"]?.[0] === "WhatsappOutboundQueue",
  "WhatsappSender event source must be WhatsappOutboundQueue",
);
assert(
  senderMappings[0].Properties.FunctionResponseTypes?.includes("ReportBatchItemFailures"),
  "WhatsappSender must enable partial batch responses",
);

const routeKeys = Object.values(resources)
  .filter((value) => value.Type === "AWS::ApiGatewayV2::Route")
  .map((value) => value.Properties?.RouteKey);

for (const routeKey of [
  "GET /webhooks/whatsapp/{webhookKey}",
  "POST /webhooks/whatsapp/{webhookKey}",
  "POST /v1/tenants/{tenantId}/integrations/whatsapp",
]) {
  assert(routeKeys.includes(routeKey), `Missing WhatsApp route: ${routeKey}`);
}

const privateRole = resource("PrivateApiLambdaRole", "AWS::IAM::Role");
const privateStatements = privateRole.Properties.Policies.flatMap(
  (policy) => policy.PolicyDocument.Statement,
);
const outboundStatement = privateStatements.find((statement) =>
  (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes(
    "sqs:SendMessage",
  ),
);
const outboundResources = Array.isArray(outboundStatement?.Resource)
  ? outboundStatement.Resource
  : [outboundStatement?.Resource];
assert(
  outboundResources.some((value) => value?.["Fn::GetAtt"]?.[0] === "WhatsappOutboundQueue"),
  "PrivateApiLambdaRole must publish to WhatsappOutboundQueue",
);

process.stdout.write(
  "Phase 4 WhatsApp onboarding, webhook, sender, routes, and IAM shape is valid.\n",
);
