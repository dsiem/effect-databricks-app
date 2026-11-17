import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3011";

export default defineConfig({
  testDir: "e2e",
  testMatch: [
    "trip-grid.spec.ts",
    "theme.spec.ts",
    "browser-compat.spec.ts",
    "foldkit.spec.ts",
    "gps-map.spec.ts",
    "genie-recovery.spec.ts",
    "genie-helper.spec.ts",
    "saved-views-conflicts.spec.ts",
    "saved-views-pagination.spec.ts",
    "saved-views-search.spec.ts",
    "trip-comments.spec.ts",
    "filter-validation.spec.ts",
    "ui.spec.ts",
    "design.spec.ts",
    "date-range.spec.ts",
    "filter-workflow.spec.ts",
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
