import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: [
    "genie-recovery.spec.ts",
    "ui.spec.ts",
    "date-range.spec.ts",
    "explore-context.spec.ts",
  ],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3011",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node dist/main.js",
    url: "http://127.0.0.1:3011/health",
    env: {
      DATABRICKS_APP_PORT: "3011",
      APP_HTTP_PROTOCOL: "http1",
      DATABRICKS_HOST: "",
      DATABRICKS_WAREHOUSE_ID: "",
      GENIE_SPACE_ID: "",
      PGHOST: "",
      LAKEBASE_ENDPOINT: "",
    },
  },
  reporter: "list",
});
