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
  "kms:Encrypt",
  "s3:DeleteObject",
]) {
  assert(actions.includes(action), `PlatformAdminLambdaRole must allow ${action}`);
}
assert(!actions.includes("kms:Decrypt"), "PlatformAdminLambdaRole must not decrypt OpenAI keys");
assert(
  !actions.some((action) => action.startsWith("secretsmanager:")),
  "PlatformAdminLambdaRole must not use Secrets Manager for OpenAI credentials",
);
const encryptStatement = statements.find((statement) =>
  (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes("kms:Encrypt"),
);
assert(
  encryptStatement?.Resource?.["Fn::GetAtt"]?.[0] === "ProviderCredentialsKey",
  "PlatformAdmin kms:Encrypt must be scoped to ProviderCredentialsKey",
);
assert(
  encryptStatement?.Condition?.StringEquals?.["kms:EncryptionContext:stage"] === "dev" &&
    encryptStatement.Condition.StringEquals["kms:EncryptionContext:resourceType"] ===
      "OPENAI_CREDENTIAL" &&
    encryptStatement.Condition.StringEquals["kms:EncryptionContext:tableName"]?.Ref ===
      "MessagingControlTable",
  "PlatformAdmin kms:Encrypt must be scoped to the OpenAI credential encryption context",
);

const adminFunction = resources.PlatformAdminLambdaFunction;
const adminEnvironment = adminFunction.Properties.Environment.Variables;
assert(
  adminEnvironment.MEDIA_BUCKET !== undefined,
  "PlatformAdmin Lambda must receive MEDIA_BUCKET",
);
for (const name of ["CONTROL_TABLE", "PROVIDER_CREDENTIALS_KEY_ARN", "STAGE"]) {
  assert(adminEnvironment[name] !== undefined, `PlatformAdmin Lambda is missing ${name}`);
}
assert(
  adminEnvironment.PROVIDER_CREDENTIALS_KEY_ARN?.["Fn::GetAtt"]?.[0] === "ProviderCredentialsKey",
  "PlatformAdmin Lambda must receive ProviderCredentialsKey",
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
  ["PUT /v1/platform/integrations/{integrationId}/openai-credential", true],
  ["DELETE /v1/platform/integrations/{integrationId}/openai-credential", true],
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
