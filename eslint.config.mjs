import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const typeScriptFiles = ["**/*.ts"];
const applyToTypeScript = (configs) =>
  configs.map((config) => ({
    ...config,
    files: typeScriptFiles,
  }));

export default tseslint.config(
  {
    ignores: [".build/**", ".serverless/**", "coverage/**", "dist/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...applyToTypeScript(tseslint.configs.strictTypeChecked),
  ...applyToTypeScript(tseslint.configs.stylisticTypeChecked),
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        {
          ignoreArrowShorthand: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/require-await": "error",
      "no-console": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
);
