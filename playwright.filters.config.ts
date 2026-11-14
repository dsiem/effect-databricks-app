import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.architecture.config";

export default defineConfig(base, {
  testMatch: [
    "browser-compat.spec.ts",
    "filter-workflow.spec.ts",
    "date-range.spec.ts",
    "explore-context.spec.ts",
    "notebook-conflicts.spec.ts",
    "notebook-pagination.spec.ts",
  ],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "ipad", use: { ...devices["iPad Pro 11"], browserName: "webkit" } },
  ],
});
