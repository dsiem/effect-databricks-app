import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const directory = process.env.MAP_STUDY_OUTPUT || ".databricks/map-prototypes";
mkdirSync(directory, { recursive: true });
const data = JSON.parse(
  readFileSync(".databricks/map-prototypes/data.json", "utf8"),
);
assert.equal(
  data.density.reduce((sum, cell) => sum + cell.trips, 0),
  data.metadata.pickups,
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1720, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5186");
  await page.waitForFunction(
    () => document.querySelectorAll('.map[data-ready="true"]').length === 3,
  );
  await page.screenshot({
    path: `${directory}/city-comparison.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Street view", exact: true }).click();
  await page.waitForFunction(() =>
    window.mapStudy.every((map) => !map.isMoving() && map.getZoom() > 13),
  );
  const popular = data.density.reduce((best, cell) =>
    cell.trips > best.trips ? cell : best,
  );
  const point = await page.evaluate((center) => {
    const map = window.mapStudy[1];
    const projected = map.project(center);
    const bounds = map.getContainer().getBoundingClientRect();
    return { x: bounds.x + projected.x, y: bounds.y + projected.y };
  }, popular.center);
  await page.mouse.move(point.x, point.y);
  await page.screenshot({
    path: `${directory}/street-comparison.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${directory}/mobile-comparison.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    `${directory}/verification.json`,
    JSON.stringify(
      {
        source: data.source,
        trips: data.metadata.trips,
        pickupTrips: data.metadata.pickups,
        sampledPoints: data.points.length,
        densityCells: data.density.length,
        flows: data.flows.length,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Three real-data maps rendered; city/street controls, density reconciliation and mobile layout passed.",
  );
} finally {
  await browser.close();
}
