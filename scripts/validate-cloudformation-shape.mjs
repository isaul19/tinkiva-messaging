import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const templatePath = resolve(
  process.cwd(),
  ".serverless",
  "cloudformation-template-update-stack.json",
);
const template = JSON.parse(readFileSync(templatePath, "utf8"));

for (const [outputId, output] of Object.entries(template.Outputs ?? {})) {
  const value = output.Value;

  if (typeof value === "object" && value !== null) {
    const intrinsicCount = Object.keys(value).length;

    if (intrinsicCount !== 1) {
      throw new Error(
        `${outputId}.Value must contain one CloudFormation intrinsic, received ${intrinsicCount}`,
      );
    }
  }
}

process.stdout.write("CloudFormation output shapes are valid.\n");
