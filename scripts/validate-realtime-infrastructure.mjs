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
  if (!condition) throw new Error(message);
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

const actions = (role) =>
  role.Properties.Policies.flatMap((policy) =>
    policy.PolicyDocument.Statement.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    ),
  );

const websocketApi = resource("WebsocketsApi", "AWS::ApiGatewayV2::Api");
assert(websocketApi.Properties.ProtocolType === "WEBSOCKET", "Realtime API must be WebSocket");
assert(
  websocketApi.Properties.RouteSelectionExpression === "$request.body.action",
  "Realtime API must route by body.action",
);

for (const routeKey of ["$connect", "$disconnect", "$default", "ping"]) {
  const exists = Object.values(resources).some(
    (value) => value.Type === "AWS::ApiGatewayV2::Route" && value.Properties?.RouteKey === routeKey,
  );
  assert(exists, `Missing realtime route: ${routeKey}`);
}

const ticketRouteExists = Object.values(resources).some(
  (value) =>
    value.Type === "AWS::ApiGatewayV2::Route" &&
    value.Properties?.RouteKey === "POST /v1/tenants/{tenantId}/realtime/tickets",
);
assert(ticketRouteExists, "Missing private API route for realtime tickets");

for (const functionId of [
  "AppEventProjectorLambdaFunction",
  "RealtimeConnectionLambdaFunction",
  "RealtimeDispatcherLambdaFunction",
]) {
  resource(functionId, "AWS::Lambda::Function");
}

const projectorFunction = resource("AppEventProjectorLambdaFunction", "AWS::Lambda::Function");
assert(
  typeof projectorFunction.Properties.Environment?.Variables?.STORAGIA_AUTOMATION_APPLICATION_ID ===
    "string" &&
    projectorFunction.Properties.Environment.Variables.STORAGIA_AUTOMATION_APPLICATION_ID.length >
      0,
  "App event projector must receive the StoragIA application ID",
);
assert(
  projectorFunction.Properties.Environment?.Variables?.STORAGIA_AUTOMATION_QUEUE_URL?.Ref ===
    "StoragiaAutomationQueue",
  "App event projector must receive the StoragIA automation queue URL",
);

const dataTable = resource("MessagingDataTable", "AWS::DynamoDB::Table");
assert(
  dataTable.Properties.StreamSpecification?.StreamViewType === "NEW_AND_OLD_IMAGES",
  "MessagingDataTable must expose NEW_AND_OLD_IMAGES",
);

const projectorMapping = resource(
  "AppEventProjectorEventSourceMappingDynamodbMessagingDataTable",
  "AWS::Lambda::EventSourceMapping",
);
assert(
  projectorMapping.Properties.FunctionResponseTypes?.includes("ReportBatchItemFailures"),
  "App event projector must report partial batch failures",
);
assert(
  projectorMapping.Properties.FilterCriteria?.Filters?.[0]?.Pattern?.includes('"MESSAGE"'),
  "App event projector must filter durable message records",
);

const dispatcherMapping = resource(
  "RealtimeDispatcherEventSourceMappingSQSAppEventsQueue",
  "AWS::Lambda::EventSourceMapping",
);
assert(
  dispatcherMapping.Properties.FunctionResponseTypes?.includes("ReportBatchItemFailures"),
  "Realtime dispatcher must report partial batch failures",
);

const projectorRole = resource("AppEventProjectorLambdaRole", "AWS::IAM::Role");
for (const requiredAction of [
  "dynamodb:DescribeStream",
  "dynamodb:GetRecords",
  "dynamodb:GetShardIterator",
  "dynamodb:ListStreams",
  "sqs:SendMessage",
]) {
  assert(
    actions(projectorRole).includes(requiredAction),
    `Projector role must allow ${requiredAction}`,
  );
}

const projectorQueueStatement = projectorRole.Properties.Policies.flatMap(
  (policy) => policy.PolicyDocument.Statement,
).find((statement) =>
  (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes(
    "sqs:SendMessage",
  ),
);
const projectorQueueResources = Array.isArray(projectorQueueStatement?.Resource)
  ? projectorQueueStatement.Resource
  : [projectorQueueStatement?.Resource];
for (const queueId of ["AppEventsQueue", "StoragiaAutomationQueue"]) {
  assert(
    projectorQueueResources.some(
      (value) => value?.["Fn::GetAtt"]?.[0] === queueId && value["Fn::GetAtt"]?.[1] === "Arn",
    ),
    `Projector role must publish to ${queueId}`,
  );
}

const storagiaConsumerMapping = Object.values(resources).find(
  (value) =>
    value.Type === "AWS::Lambda::EventSourceMapping" &&
    value.Properties?.EventSourceArn?.["Fn::GetAtt"]?.[0] === "StoragiaAutomationQueue",
);
assert(
  storagiaConsumerMapping === undefined,
  "StoragIA automation queue must not have a Lambda consumer in TinkivaMessaging",
);

const connectionRole = resource("RealtimeConnectionLambdaRole", "AWS::IAM::Role");
for (const requiredAction of [
  "dynamodb:DeleteItem",
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:TransactWriteItems",
]) {
  assert(
    actions(connectionRole).includes(requiredAction),
    `Connection role must allow ${requiredAction}`,
  );
}

const dispatcherRole = resource("RealtimeDispatcherLambdaRole", "AWS::IAM::Role");
for (const requiredAction of [
  "dynamodb:DeleteItem",
  "dynamodb:Query",
  "dynamodb:TransactWriteItems",
  "execute-api:ManageConnections",
  "sqs:ReceiveMessage",
]) {
  assert(
    actions(dispatcherRole).includes(requiredAction),
    `Dispatcher role must allow ${requiredAction}`,
  );
}

assert(
  template.Outputs?.RealtimeWebsocketUrl !== undefined,
  "Missing RealtimeWebsocketUrl CloudFormation output",
);

process.stdout.write(
  "Realtime WebSocket, stream projection, queue delivery, and IAM shape is valid.\n",
);
