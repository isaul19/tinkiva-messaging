import { Buffer } from "node:buffer";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const template = JSON.parse(
  readFileSync(
    resolve(process.cwd(), ".serverless", "cloudformation-template-update-stack.json"),
    "utf8",
  ),
);
const resources = template.Resources ?? {};
const outputs = template.Outputs ?? {};
const serializedTemplate = JSON.stringify(template);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const resource = (logicalId, type) => {
  const value = resources[logicalId];
  assert(value?.Type === type, `Missing or invalid ${logicalId}`);
  return value;
};

const worker = resource("MediaEnrichmentWorkerLambdaFunction", "AWS::Lambda::Function");
assert(worker.Properties.Timeout === 120, "Media worker timeout must cover FFmpeg plus OpenAI");
const queue = resource("MediaQueue", "AWS::SQS::Queue");
assert(
  queue.Properties.VisibilityTimeout >= worker.Properties.Timeout * 6,
  "Media queue visibility must be at least six times the worker timeout",
);
assert(
  resources.OpenAICredentialsSecret === undefined,
  "The retired global OpenAI Secrets Manager resource remains",
);
assert(
  outputs.OpenAICredentialsSecretArn === undefined,
  "The retired global OpenAI secret output remains",
);
assert(
  !serializedTemplate.includes("OpenAICredentialsSecret") &&
    !serializedTemplate.includes("OPENAI_CREDENTIALS_SECRET_ARN"),
  "The packaged stack still references the retired global OpenAI secret",
);
assert(
  resources.AudioMediaEnrichmentFinalizerLambdaFunction === undefined,
  "Transcribe finalizer remains",
);
assert(resources.MediaEnrichmentFinalizerLambdaRole === undefined, "Transcribe role remains");

const environment = worker.Properties.Environment.Variables;
for (const name of [
  "CONTROL_TABLE",
  "DATA_TABLE",
  "MEDIA_BUCKET",
  "OPENAI_AUDIO_MODEL",
  "OPENAI_IMAGE_MODEL",
  "PROVIDER_CREDENTIALS_KEY_ARN",
  "STAGE",
]) {
  assert(environment[name] !== undefined, `Media worker is missing ${name}`);
}
assert(environment.OPENAI_API_KEY === undefined, "The OpenAI API key must never be plain text");
assert(
  environment.OPENAI_CREDENTIALS_SECRET_ARN === undefined,
  "Media worker must not receive the retired global OpenAI secret ARN",
);
assert(
  environment.PROVIDER_CREDENTIALS_KEY_ARN?.["Fn::GetAtt"]?.[0] === "ProviderCredentialsKey",
  "Media worker must receive ProviderCredentialsKey",
);

const role = resource("MediaEnrichmentWorkerLambdaRole", "AWS::IAM::Role");
const statements = role.Properties.Policies.flatMap((policy) => policy.PolicyDocument.Statement);
const actions = statements.flatMap((statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action],
);
for (const action of [
  "dynamodb:ConditionCheckItem",
  "dynamodb:GetItem",
  "dynamodb:TransactWriteItems",
  "dynamodb:UpdateItem",
  "kms:Decrypt",
  "s3:GetObject",
  "sqs:ReceiveMessage",
]) {
  assert(actions.includes(action), `Media worker must allow ${action}`);
}
assert(
  !actions.some((action) => action.startsWith("secretsmanager:")),
  "Media worker must have zero Secrets Manager permissions",
);
assert(!actions.includes("kms:Encrypt"), "Media worker must not encrypt credentials");
assert(!actions.some((action) => /bedrock|transcribe/i.test(action)), "Legacy AI IAM remains");

const decryptStatement = statements.find((statement) =>
  (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes("kms:Decrypt"),
);
assert(
  decryptStatement?.Resource?.["Fn::GetAtt"]?.[0] === "ProviderCredentialsKey",
  "Media worker kms:Decrypt must be scoped to ProviderCredentialsKey",
);
assert(
  decryptStatement?.Condition?.StringEquals?.["kms:EncryptionContext:stage"] === "dev" &&
    decryptStatement.Condition.StringEquals["kms:EncryptionContext:resourceType"] ===
      "OPENAI_CREDENTIAL" &&
    decryptStatement.Condition.StringEquals["kms:EncryptionContext:tableName"]?.Ref ===
      "MessagingControlTable",
  "Media worker kms:Decrypt must be scoped to the OpenAI credential encryption context",
);
const credentialReadStatement = statements.find((statement) =>
  (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes(
    "dynamodb:GetItem",
  ),
);
assert(
  credentialReadStatement?.Resource?.["Fn::GetAtt"]?.[0] === "MessagingControlTable",
  "Media worker credential reads must be scoped to MessagingControlTable",
);

const packageDirectory = resolve(process.cwd(), ".serverless");
const lambdaPackages = readdirSync(packageDirectory).filter((name) => name.endsWith(".zip"));
const workerPackageName = lambdaPackages.find((name) =>
  name.endsWith("-mediaEnrichmentWorker.zip"),
);
assert(workerPackageName !== undefined, "Media enrichment worker package is missing");
const ffmpegEntryName = "node_modules/@ffmpeg-installer/linux-arm64/ffmpeg";
const workerPackage = readFileSync(resolve(packageDirectory, workerPackageName));
const ffmpeg = readZipEntry(workerPackage, ffmpegEntryName);
assert(ffmpeg !== undefined, "Media worker package does not contain FFmpeg");
assert(
  ffmpeg.length > 1_000_000 && ffmpeg.length < 50_000_000,
  "Packaged FFmpeg has an implausible size",
);
assert(
  ffmpeg.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
    ffmpeg[4] === 2 &&
    ffmpeg[5] === 1 &&
    ffmpeg.readUInt16LE(18) === 183,
  "Packaged FFmpeg must be a 64-bit little-endian AArch64 ELF executable",
);
for (const packageName of lambdaPackages) {
  if (packageName === workerPackageName) continue;
  assert(
    !readFileSync(resolve(packageDirectory, packageName)).includes(Buffer.from(ffmpegEntryName)),
    `FFmpeg must not bloat unrelated Lambda package ${packageName}`,
  );
}

process.stdout.write(
  "OpenAI media enrichment Lambda, per-integration DynamoDB/KMS credentials, and IAM shape are valid.\n",
);

function readZipEntry(archive, expectedName) {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (
    let offset = archive.length - 22;
    offset >= Math.max(0, archive.length - 65_557);
    offset -= 1
  ) {
    if (archive.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  assert(endOffset >= 0, "Lambda package has no ZIP end record");

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    assert(archive.readUInt32LE(centralOffset) === 0x02014b50, "Invalid ZIP directory entry");
    const compressionMethod = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const fileNameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive
      .subarray(centralOffset + 46, centralOffset + 46 + fileNameLength)
      .toString("utf8");

    if (name === expectedName) {
      assert(archive.readUInt32LE(localOffset) === 0x04034b50, "Invalid ZIP local entry");
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      if (compressionMethod === 0) return compressed;
      if (compressionMethod === 8) return inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method ${String(compressionMethod)}`);
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return undefined;
}
