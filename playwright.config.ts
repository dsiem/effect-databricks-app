import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  fullyParallel: false,
  use: {
    baseURL: process.env.APP_TEST_URL ?? "http://127.0.0.1:3000",
    browserName: "chromium",
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  reporter: "list",
});
