import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const template = JSON.parse(
  readFileSync(
    resolve(process.cwd(), ".serverless", "cloudformation-template-update-stack.json"),
    "utf8",
  ),
);
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

resource("PlatformAdminLambdaFunction", "AWS::Lambda::Function");
const role = resource("PlatformAdminLambdaRole", "AWS::IAM::Role");
const statements = role.Properties.Policies.flatMap((policy) => policy.PolicyDocument.Statement);
const actions = statements.flatMap((statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action],
);

for (const action of [
  "dynamodb:BatchGetItem",
  "dynamodb:BatchWriteItem",
  "dynamodb:ConditionCheckItem",
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:Query",
  "dynamodb:Scan",
  "dynamodb:TransactWriteItems",
  "dynamodb:UpdateItem",
  "s3:DeleteObject",
]) {
  assert(actions.includes(action), `PlatformAdminLambdaRole must allow ${action}`);
}
assert(!actions.includes("kms:Decrypt"), "PlatformAdminLambdaRole must not decrypt OpenAI keys");
assert(!actions.includes("kms:Encrypt"), "PlatformAdminLambdaRole must not encrypt tenant keys");
assert(
  !actions.some((action) => action.startsWith("secretsmanager:")),
  "PlatformAdminLambdaRole must not use Secrets Manager for OpenAI credentials",
);
const adminFunction = resources.PlatformAdminLambdaFunction;
const adminEnvironment = adminFunction.Properties.Environment.Variables;
assert(
  adminEnvironment.MEDIA_BUCKET !== undefined,
  "PlatformAdmin Lambda must receive MEDIA_BUCKET",
);
for (const name of [
  "CONTROL_TABLE",
  "PROVIDER_CREDENTIALS_KEY_ARN",
  "TINKIVA_INTEGRATIONS_TABLE",
  "STAGE",
]) {
  assert(adminEnvironment[name] !== undefined, `PlatformAdmin Lambda is missing ${name}`);
}
assert(
  adminEnvironment.PROVIDER_CREDENTIALS_KEY_ARN?.["Fn::GetAtt"]?.[0] === "ProviderCredentialsKey",
  "PlatformAdmin Lambda must receive ProviderCredentialsKey",
);
assert(
  adminEnvironment.TINKIVA_INTEGRATIONS_TABLE?.Ref === "TinkivaTenantIntegrations",
  "PlatformAdmin Lambda must receive TinkivaTenantIntegrations",
);
assert(
  adminEnvironment.OPENAI_CREDENTIALS_SECRET_ARN === undefined &&
    adminEnvironment.OPENAI_API_KEY === undefined,
  "PlatformAdmin Lambda must not receive a global or plaintext OpenAI credential",
);

const expectedRoutes = new Map([
  ["GET /admin", false],
  ["GET /v1/platform/integrations", true],
  ["PATCH /v1/platform/integrations/{integrationId}/inbound-media", true],
  ["POST /v1/platform/integrations/{integrationId}/deletions", true],
]);

for (const route of Object.values(resources).filter(
  (value) => value.Type === "AWS::ApiGatewayV2::Route",
)) {
  const expectedAuthorization = expectedRoutes.get(route.Properties?.RouteKey);
  if (expectedAuthorization === undefined) continue;
  if (expectedAuthorization) {
    assert(
      route.Properties.AuthorizationType === "CUSTOM" &&
        route.Properties.AuthorizerId !== undefined,
      `${route.Properties.RouteKey} must use the application authorizer`,
    );
  } else {
    assert(
      (route.Properties.AuthorizationType === undefined ||
        route.Properties.AuthorizationType === "NONE") &&
        route.Properties.AuthorizerId === undefined,
      `${route.Properties.RouteKey} must serve the public login shell without an authorizer`,
    );
  }
  expectedRoutes.delete(route.Properties.RouteKey);
}

assert(
  expectedRoutes.size === 0,
  `Missing platform admin routes: ${[...expectedRoutes.keys()].join(", ")}`,
);
process.stdout.write("Platform admin Lambda, routes, and IAM shape are valid.\n");
