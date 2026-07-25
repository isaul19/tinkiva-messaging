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

resource("ProviderCredentialsKey", "AWS::KMS::Key");
resource("ProviderCredentialsKeyAlias", "AWS::KMS::Alias");
resource("TelegramWebhookLambdaFunction", "AWS::Lambda::Function");
const webhookRole = resource("TelegramWebhookLambdaRole", "AWS::IAM::Role");
const webhookStatements = webhookRole.Properties.Policies.flatMap(
  (policy) => policy.PolicyDocument.Statement,
);
const webhookActions = webhookStatements.flatMap((statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action],
);

for (const action of ["dynamodb:GetItem", "kms:Decrypt", "sqs:SendMessage"]) {
  assert(webhookActions.includes(action), `TelegramWebhookLambdaRole must allow ${action}`);
}

for (const statement of webhookStatements) {
  const iamResources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];
  assert(
    !iamResources.includes("*"),
    "TelegramWebhookLambdaRole must not contain wildcard resources",
  );
}

resource("InboundProcessorLambdaFunction", "AWS::Lambda::Function");
const inboundRole = resource("InboundProcessorLambdaRole", "AWS::IAM::Role");
const inboundStatements = inboundRole.Properties.Policies.flatMap(
  (policy) => policy.PolicyDocument.Statement,
);
const inboundActions = inboundStatements.flatMap((statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action],
);

for (const action of [
  "sqs:ReceiveMessage",
  "sqs:DeleteMessage",
  "sqs:GetQueueAttributes",
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:TransactWriteItems",
]) {
  assert(inboundActions.includes(action), `InboundProcessorLambdaRole must allow ${action}`);
}

for (const statement of inboundStatements) {
  const iamResources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];
  assert(
    !iamResources.includes("*"),
    "InboundProcessorLambdaRole must not contain wildcard resources",
  );
}

const inboundEventSourceMappings = Object.values(resources).filter(
  (value) =>
    value.Type === "AWS::Lambda::EventSourceMapping" &&
    value.Properties?.FunctionName?.["Fn::GetAtt"]?.[0] === "InboundProcessorLambdaFunction",
);
assert(
  inboundEventSourceMappings.length === 1,
  "InboundProcessor must have exactly one SQS event source mapping",
);
const inboundEventSource = inboundEventSourceMappings[0].Properties;
assert(
  inboundEventSource.EventSourceArn?.["Fn::GetAtt"]?.[0] === "InboundQueue",
  "InboundProcessor event source must be InboundQueue",
);
assert(
  inboundEventSource.FunctionResponseTypes?.includes("ReportBatchItemFailures"),
  "InboundProcessor must enable partial batch responses",
);

resource("TelegramSenderLambdaFunction", "AWS::Lambda::Function");
const senderRole = resource("TelegramSenderLambdaRole", "AWS::IAM::Role");
const senderStatements = senderRole.Properties.Policies.flatMap(
  (policy) => policy.PolicyDocument.Statement,
);
const senderActions = senderStatements.flatMap((statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action],
);

for (const action of [
  "sqs:ReceiveMessage",
  "sqs:DeleteMessage",
  "sqs:GetQueueAttributes",
  "dynamodb:GetItem",
  "dynamodb:UpdateItem",
  "kms:Decrypt",
]) {
  assert(senderActions.includes(action), `TelegramSenderLambdaRole must allow ${action}`);
}

for (const statement of senderStatements) {
  const iamResources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];
  assert(
    !iamResources.includes("*"),
    "TelegramSenderLambdaRole must not contain wildcard resources",
  );
}

const senderEventSourceMappings = Object.values(resources).filter(
  (value) =>
    value.Type === "AWS::Lambda::EventSourceMapping" &&
    value.Properties?.FunctionName?.["Fn::GetAtt"]?.[0] === "TelegramSenderLambdaFunction",
);
assert(
  senderEventSourceMappings.length === 1,
  "TelegramSender must have exactly one SQS event source mapping",
);
const senderEventSource = senderEventSourceMappings[0].Properties;
assert(
  senderEventSource.EventSourceArn?.["Fn::GetAtt"]?.[0] === "TelegramOutboundQueue",
  "TelegramSender event source must be TelegramOutboundQueue",
);
assert(
  senderEventSource.FunctionResponseTypes?.includes("ReportBatchItemFailures"),
  "TelegramSender must enable partial batch responses",
);

const privateRole = resource("PrivateApiLambdaRole", "AWS::IAM::Role");
const privateActions = privateRole.Properties.Policies.flatMap((policy) =>
  policy.PolicyDocument.Statement.flatMap((statement) =>
    Array.isArray(statement.Action) ? statement.Action : [statement.Action],
  ),
);

for (const action of ["dynamodb:DeleteItem", "dynamodb:UpdateItem", "kms:Encrypt"]) {
  assert(privateActions.includes(action), `PrivateApiLambdaRole must allow ${action}`);
}

const routeKeys = Object.values(resources)
  .filter((value) => value.Type === "AWS::ApiGatewayV2::Route")
  .map((value) => value.Properties?.RouteKey);

for (const routeKey of [
  "POST /webhooks/telegram/{webhookKey}",
  "POST /v1/tenants/{tenantId}/integrations/telegram",
]) {
  assert(routeKeys.includes(routeKey), `Missing Telegram route: ${routeKey}`);
}

process.stdout.write(
  "Phase 3 Telegram onboarding, webhook, inbound processor, sender, and IAM shape is valid.\n",
);
