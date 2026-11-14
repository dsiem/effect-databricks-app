import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3011";

export default defineConfig({
  testDir: "e2e",
  testMatch: [
    "browser-compat.spec.ts",
    "foldkit.spec.ts",
    "map.spec.ts",
    "genie-recovery.spec.ts",
    "genie-helper.spec.ts",
    "notebook-conflicts.spec.ts",
    "notebook-pagination.spec.ts",
    "trip-comments.spec.ts",
    "filter-validation.spec.ts",
    "ui.spec.ts",
    "design.spec.ts",
    "date-range.spec.ts",
    "explore-context.spec.ts",
  ],
  timeout: 30_000,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node dist/src/main.js",
    url: `http://127.0.0.1:${port}/health`,
    env: {
      DATABRICKS_APP_PORT: port,
      DATABRICKS_HOST: "",
      DATABRICKS_WAREHOUSE_ID: "",
      GENIE_SPACE_ID: "",
      PGHOST: "",
      LAKEBASE_ENDPOINT: "",
    },
  },
  reporter: "list",
});
