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

for (const functionId of [
  "AuthTokenLambdaFunction",
  "ApiAuthorizerLambdaFunction",
  "PrivateApiLambdaFunction",
]) {
  resource(functionId, "AWS::Lambda::Function");
}

resource("HttpApiAuthorizerApplicationAuthorizer", "AWS::ApiGatewayV2::Authorizer");

const privateRole = resource("PrivateApiLambdaRole", "AWS::IAM::Role");
const privateActions = privateRole.Properties.Policies.flatMap((policy) =>
  policy.PolicyDocument.Statement.flatMap((statement) =>
    Array.isArray(statement.Action) ? statement.Action : [statement.Action],
  ),
);

for (const requiredAction of [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:Query",
  "dynamodb:TransactWriteItems",
  "dynamodb:UpdateItem",
  "sqs:SendMessage",
]) {
  assert(
    privateActions.includes(requiredAction),
    `PrivateApiLambdaRole must allow ${requiredAction}`,
  );
}

const messageRouteExists = Object.values(resources).some(
  (value) =>
    value.Type === "AWS::ApiGatewayV2::Route" && value.Properties?.RouteKey === "POST /v1/messages",
);
assert(messageRouteExists, "Missing private API route: POST /v1/messages");

const authRole = resource("AuthTokenLambdaRole", "AWS::IAM::Role");
const authorizerRole = resource("ApiAuthorizerLambdaRole", "AWS::IAM::Role");

for (const role of [authRole, authorizerRole, privateRole]) {
  for (const policy of role.Properties.Policies) {
    for (const statement of policy.PolicyDocument.Statement) {
      const iamResources = Array.isArray(statement.Resource)
        ? statement.Resource
        : [statement.Resource];
      assert(!iamResources.includes("*"), "Phase 2 roles must not contain wildcard resources");
    }
  }
}

process.stdout.write("Phase 2 Lambda, authorizer, and least-privilege IAM shape is valid.\n");
