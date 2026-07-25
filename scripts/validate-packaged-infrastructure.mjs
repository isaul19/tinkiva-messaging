import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const templatePath = resolve(
  process.cwd(),
  ".serverless",
  "cloudformation-template-update-stack.json",
);
const template = JSON.parse(readFileSync(templatePath, "utf8"));
const resources = template.Resources ?? {};
const outputs = template.Outputs ?? {};

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

const queuePairs = [
  ["InboundQueue", "InboundDlq", true, 180],
  ["WhatsappOutboundQueue", "WhatsappOutboundDlq", true, 180],
  ["TelegramOutboundQueue", "TelegramOutboundDlq", true, 180],
  ["AppEventsQueue", "AppEventsDlq", true, 180],
  ["MediaQueue", "MediaDlq", false, 360],
];

for (const [queueId, dlqId, fifo, visibilityTimeout] of queuePairs) {
  const queue = resource(queueId, "AWS::SQS::Queue");
  const dlq = resource(dlqId, "AWS::SQS::Queue");

  assert(queue.Properties.SqsManagedSseEnabled === true, `${queueId} must use SQS encryption`);
  assert(dlq.Properties.SqsManagedSseEnabled === true, `${dlqId} must use SQS encryption`);
  assert(
    queue.Properties.VisibilityTimeout === visibilityTimeout,
    `${queueId} has an invalid visibility timeout`,
  );
  assert(
    queue.Properties.RedrivePolicy.maxReceiveCount === 5,
    `${queueId} must redrive after five receives`,
  );
  assert(
    dlq.Properties.MessageRetentionPeriod === 1_209_600,
    `${dlqId} must retain messages for 14 days`,
  );
  assert(Boolean(queue.Properties.FifoQueue) === fifo, `${queueId} FIFO configuration is invalid`);
  assert(Boolean(dlq.Properties.FifoQueue) === fifo, `${dlqId} FIFO configuration is invalid`);
}

const controlTable = resource("MessagingControlTable", "AWS::DynamoDB::Table");
const dataTable = resource("MessagingDataTable", "AWS::DynamoDB::Table");

for (const table of [controlTable, dataTable]) {
  assert(table.Properties.BillingMode === "PAY_PER_REQUEST", "DynamoDB must use on-demand billing");
  assert(table.Properties.SSESpecification.SSEEnabled === true, "DynamoDB encryption is required");
  assert(table.Properties.TimeToLiveSpecification.Enabled === true, "DynamoDB TTL must be enabled");
}

assert(
  controlTable.Properties.GlobalSecondaryIndexes?.[0]?.IndexName === "GSI1",
  "The control table must expose GSI1",
);

const mediaBucket = resource("MessagingMediaBucket", "AWS::S3::Bucket");
const publicAccess = mediaBucket.Properties.PublicAccessBlockConfiguration;

assert(
  publicAccess.BlockPublicAcls &&
    publicAccess.BlockPublicPolicy &&
    publicAccess.IgnorePublicAcls &&
    publicAccess.RestrictPublicBuckets,
  "The media bucket must block every form of public access",
);
assert(
  mediaBucket.Properties.OwnershipControls.Rules[0].ObjectOwnership === "BucketOwnerEnforced",
  "The media bucket must disable ACL ownership",
);
resource("MessagingMediaBucketPolicy", "AWS::S3::BucketPolicy");

for (const secretId of ["AuthPepperSecret", "JwtSigningSecret"]) {
  const secret = resource(secretId, "AWS::SecretsManager::Secret");
  assert(
    secret.Properties.GenerateSecretString.PasswordLength >= 64,
    `${secretId} must generate at least 64 characters`,
  );
}

resource("MessagingAlarmTopic", "AWS::SNS::Topic");
for (const alarmId of [
  "InboundDlqAlarm",
  "WhatsappOutboundDlqAlarm",
  "TelegramOutboundDlqAlarm",
  "AppEventsDlqAlarm",
  "MediaDlqAlarm",
]) {
  const alarm = resource(alarmId, "AWS::CloudWatch::Alarm");
  assert(alarm.Properties.Threshold === 1, `${alarmId} must trigger on the first DLQ message`);
}

const healthRole = resource("HealthLambdaRole", "AWS::IAM::Role");
const roleStatements = healthRole.Properties.Policies.flatMap(
  (policy) => policy.PolicyDocument.Statement,
);

for (const statement of roleStatements) {
  const iamResources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];

  assert(!iamResources.includes("*"), "HealthLambdaRole must not contain wildcard resources");
}

for (const outputId of [
  "HttpApiId",
  "HttpApiUrl",
  "ControlTableName",
  "DataTableName",
  "MediaBucketName",
  "InboundQueueUrl",
  "WhatsappOutboundQueueUrl",
  "TelegramOutboundQueueUrl",
  "AppEventsQueueUrl",
  "MediaQueueUrl",
  "AuthPepperSecretArn",
  "JwtSigningSecretArn",
  "AlarmTopicArn",
]) {
  assert(outputs[outputId] !== undefined, `Missing CloudFormation output: ${outputId}`);
}

const resourceTypeCounts = Object.values(resources).reduce((counts, value) => {
  counts[value.Type] = (counts[value.Type] ?? 0) + 1;
  return counts;
}, {});

process.stdout.write(
  `${JSON.stringify(
    {
      resourceTypeCounts,
      status: "valid",
      template: templatePath,
    },
    null,
    2,
  )}\n`,
);
