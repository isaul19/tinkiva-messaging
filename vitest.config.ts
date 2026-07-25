import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "src/application/ports/**",
        "src/cli/**",
        "src/functions/**",
        "src/infrastructure/**",
        "dist/**",
        "tests/**",
        "vitest.config.ts",
      ],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});
