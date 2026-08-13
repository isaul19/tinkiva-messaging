import { describe, expect, it } from "vitest";

import {
  createApplicationOutput,
  parseCreateApplicationArguments,
} from "../../../src/cli/create-application-options.js";

const credential = {
  applicationId: "app_01TEST",
  clientId: "msgc_01TEST",
  clientSecret: `msgs_${"s".repeat(48)}`,
  scopes: ["platform:admin" as const],
};

describe("create application CLI options", () => {
  it("delivers a client secret once without creating a per-application AWS secret by default", () => {
    const input = parseCreateApplicationArguments([
      "--code",
      "consumer_app",
      "--name",
      "Consumer application",
    ]);
    const output = createApplicationOutput({ ...credential, scopes: input.scopes });

    expect(input).toMatchObject({
      code: "CONSUMER_APP",
      region: "us-east-1",
      stage: "dev",
    });
    expect(input.credentialsSecretName).toBeUndefined();
    expect(output).toMatchObject({
      clientSecret: credential.clientSecret,
      credentialDelivery: "ONE_TIME_STDOUT",
    });
    expect(output.warning).toBe(
      "Save clientSecret now in the consumer's credential vault. Tinkiva Messaging stores only its digest and cannot recover it.",
    );
    expect(output).not.toHaveProperty("credentialsSecretName");
  });

  it("keeps Secrets Manager delivery as an explicit compatibility option", () => {
    const secretName = "/tinkiva/messaging/dev/applications/platform_admin/client";
    const input = parseCreateApplicationArguments([
      "--code",
      "PLATFORM_ADMIN",
      "--name",
      "Platform administration",
      "--scopes",
      "platform:admin",
      "--credentials-secret-name",
      secretName,
    ]);
    const output = createApplicationOutput({
      ...credential,
      credentialsSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:${secretName}`,
      credentialsSecretName: secretName,
      scopes: input.scopes,
    });

    expect(input.credentialsSecretName).toBe(secretName);
    expect(output).toMatchObject({
      credentialDelivery: "SECRETS_MANAGER",
      credentialsSecretName: secretName,
    });
    expect(output).not.toHaveProperty("clientSecret");
  });

  it("rejects incomplete name-value argument pairs", () => {
    expect(() => parseCreateApplicationArguments(["--code", "APP", "--name"])).toThrow(
      "Arguments must use --name value pairs.",
    );
  });
});
