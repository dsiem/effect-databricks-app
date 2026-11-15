import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const output = process.env.MAP_STUDY_OUTPUT || ".databricks/map-prototypes";
const cli = (args) =>
  JSON.parse(
    execFileSync("databricks", [...args, "-o", "json"], { encoding: "utf8" }),
  );
const target = process.env.GPS_PREVIEW_TARGET;
const app = target
  ? cli([
      "apps",
      "get",
      cli(["bundle", "summary", "-t", target]).resources.apps.app.name,
    ])
  : undefined;
const origin =
  app?.url || process.env.GPS_PREVIEW_URL || "http://127.0.0.1:3037";
const appOrigin = new URL(origin).origin;
const authHeaders = target
  ? { Authorization: `Bearer ${cli(["auth", "token"]).access_token}` }
  : {};
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1640, height: 1100 },
    reducedMotion: "reduce",
  });
  const errors = [];
  const cohorts = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (target)
    await page.route(
      (url) => url.origin === appOrigin,
      async (route) => {
        const response = await route.fetch({
          headers: { ...route.request().headers(), ...authHeaders },
          maxRedirects: 0,
          timeout: 120000,
        });
        await route.fulfill({ response });
      },
    );
  // Buffer through Playwright's request context: Chromium's inspector cache can
  // evict the full-data response before an asynchronous response listener reads it.
  await page.route(
    (url) => url.origin === appOrigin && url.pathname === "/api/gps-activity",
    async (route) => {
      const response = await route.fetch({
        headers: { ...route.request().headers(), ...authHeaders },
        maxRedirects: 0,
        timeout: 120000,
      });
      if (response.ok()) {
        const data = await response.json();
        cohorts.push({
          endpoint: data.endpoint,
          matching: data.matchingTrips,
          located: data.locatedTrips,
          shown: data.shownTrips,
          cells: data.cells.length,
          truncated: data.truncated,
        });
      }
      await route.fulfill({ response });
    },
  );
  const ready = async (endpoint) => {
    const map = page.getByRole("region", {
      name: `GPS ${endpoint} density map`,
      exact: true,
    });
    await map.waitFor({ timeout: 120000 });
    await page.waitForFunction(
      () =>
        document.getElementById("gps-density-map")?.dataset.gpsReady === "true",
      undefined,
      { timeout: 120000 },
    );
    return map;
  };
  await page.goto(`${origin}/gps-map`);
  const map = await ready("pickups");
  await page.screenshot({ path: `${output}/gps-city.png`, fullPage: true });
  await page.getByRole("button", { name: /^Area 1,/ }).click();
  await ready("pickups");
  // Area focus animates the camera for 350ms; wait before awaiting street tiles.
  await page.waitForTimeout(400);
  await page.waitForLoadState("networkidle");
  const bounds = await map.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.screenshot({ path: `${output}/gps-selected.png`, fullPage: true });
  await page.getByRole("tab", { name: "Drop-offs", exact: true }).click();
  await ready("drop-offs");
  await page
    .getByRole("button", { name: "Theme: System", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await page.screenshot({
    path: `${output}/gps-dropoff-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .waitFor();
  await page.waitForFunction(() => document.documentElement.scrollWidth <= 390);
  await page.screenshot({ path: `${output}/gps-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(cohorts.length, 2);
  assert.ok(
    cohorts.every(
      (row) =>
        row.matching === 22145892 &&
        row.located === row.shown &&
        !row.truncated,
    ),
  );
  writeFileSync(
    `${output}/gps-live-verification.json`,
    JSON.stringify({ cohorts, errors }, null, 2),
  );
  console.log(JSON.stringify({ cohorts, errors }));
} finally {
  await browser.close();
}
