import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const appUrl = URL.parse(process.env.DATABRICKS_APP_URL ?? "");
const isLoopback =
  appUrl?.protocol === "http:" && appUrl.hostname === "127.0.0.1";
if (
  !appUrl ||
  (appUrl.protocol !== "https:" && !isLoopback) ||
  appUrl.href !== `${appUrl.origin}/`
) {
  throw new Error(
    "Set DATABRICKS_APP_URL to the root URL of the deployed app.",
  );
}

const storageState = resolve(
  process.env.DATABRICKS_APP_STORAGE_STATE ??
    ".databricks/playwright-auth.json",
);
if (!existsSync(storageState)) {
  throw new Error(
    `Missing browser session at ${storageState}. See DEPLOYMENT.md for sign-in instructions.`,
  );
}

export default defineConfig({
  testDir: ".",
  outputDir: "../../../test-results/deployed",
  reporter: "list",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: appUrl.origin,
    browserName: "chromium",
    storageState,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
