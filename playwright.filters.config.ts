import { defineConfig } from "@playwright/test";
import base from "./playwright.architecture.config";

export default defineConfig(base, {
  testMatch: [
    "browser-compat.spec.ts",
    "filter-workflow.spec.ts",
    "date-range.spec.ts",
    "gps-map.spec.ts",
    "explore-context.spec.ts",
    "saved-views-conflicts.spec.ts",
    "saved-views-pagination.spec.ts",
  ],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
