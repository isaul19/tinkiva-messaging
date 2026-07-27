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
