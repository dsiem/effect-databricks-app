import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3011";

export default defineConfig({
  testDir: "client/test/browser",
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      testMatch: [
        "browser-compat.spec.ts",
        "date-range.spec.ts",
        "explore-context.spec.ts",
        "filter-workflow.spec.ts",
        "gps-map.spec.ts",
        "saved-views-conflicts.spec.ts",
        "saved-views-pagination.spec.ts",
      ],
    },
  ],
  webServer: {
    command: "node dist/server/src/main.js",
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
