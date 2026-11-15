import { expect, test } from "@playwright/test";
import { gpsFixture } from "../client/test/gps-fixture";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/metadata", (route) =>
    route.fulfill({
      json: { from: "2016-01-01", to: "2016-02-29", trips: 100 },
    }),
  );
  await page.route("**/api/gps-activity**", (route) =>
    route.fulfill({
      json: gpsFixture(
        new URL(route.request().url()).searchParams.get("endpoint") ===
          "dropoff"
          ? "dropoff"
          : "pickup",
      ),
    }),
  );
});
const ready = async (
  page: import("@playwright/test").Page,
  endpoint = "pickups",
) => {
  const map = page.getByRole("region", {
    name: `GPS ${endpoint} density map`,
    exact: true,
  });
  await expect(map).toHaveAttribute("data-gps-ready", "true");
  return map;
};

test("GPS map selects areas by keyboard and pointer and switches endpoints without replacing the camera", async ({
  page,
}) => {
  await page.goto("/gps-map");
  const map = await ready(page);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    navigation.getByRole("link", { name: "Trip map", exact: true }),
  ).toHaveCount(1);
  await expect(
    navigation.getByRole("link", { name: "Pickup map", exact: true }),
  ).toHaveCount(0);
  const canvas = await map.locator("canvas").first().elementHandle();
  const area = page.getByRole("button", {
    name: "Area 1, 60 pickups",
    exact: true,
  });
  await area.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Selected area", exact: true }),
  ).toBeVisible();
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("$11.25", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await ready(page);
  const bounds = await map.boundingBox();
  if (!bounds) throw new Error("Missing GPS map");
  // Selection eases the camera; keep hovering until the selected cell settles.
  await expect(async () => {
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 1,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await expect(page.locator(".gps-tooltip")).toContainText("60 pickups", {
      timeout: 500,
    });
  }).toPass();
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(
    page.getByRole("heading", { name: "Selected area", exact: true }),
  ).toBeVisible();
  const pickupTab = page.getByRole("tab", { name: "Pickups", exact: true });
  await pickupTab.focus();
  await page.keyboard.press("ArrowRight");
  await ready(page, "drop-offs");
  await expect(
    page.getByRole("tab", { name: "Drop-offs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Selected area", exact: true }),
  ).toHaveCount(0);
});

test("date and pickup ZIP filters refresh GPS data and clear area selection", async ({
  page,
}) => {
  const requests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/gps-activity"))
      requests.push(new URL(request.url()));
  });
  await page.goto("/gps-map");
  await ready(page);
  await page
    .getByRole("button", { name: "Area 1, 60 pickups", exact: true })
    .click();
  await page
    .getByLabel("Pickup start date", { exact: true })
    .fill("2016-01-10");
  await page.getByLabel("Pickup end date", { exact: true }).fill("2016-01-10");
  await page.getByLabel("Pickup ZIP code", { exact: true }).fill("10001");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(
    "/gps-map?from=2016-01-10&to=2016-01-10&zip=10001",
  );
  await ready(page);
  expect(requests.at(-1)?.searchParams.get("from")).toBe("2016-01-10");
  expect(requests.at(-1)?.searchParams.get("to")).toBe("2016-01-10");
  expect(requests.at(-1)?.searchParams.get("zip")).toBe("10001");
  await expect(
    page.getByRole("heading", { name: "Selected area", exact: true }),
  ).toHaveCount(0);
});

test("an older endpoint response cannot overwrite the latest selection", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/gps-activity**", async (route) => {
    const dropoff =
      new URL(route.request().url()).searchParams.get("endpoint") === "dropoff";
    if (dropoff) await gate;
    await route.fulfill({ json: gpsFixture(dropoff ? "dropoff" : "pickup") });
  });
  await page.goto("/gps-map");
  await ready(page);
  await page.getByRole("tab", { name: "Drop-offs", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Updating drop-offs");
  await page.getByRole("tab", { name: "Pickups", exact: true }).click();
  await ready(page);
  release();
  await expect(
    page.getByRole("heading", { name: "Where journeys begin", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Pickups", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("GPS service failure offers retry and the empty result keeps the map usable", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/gps-activity**", (route) =>
    route.fulfill(
      fail
        ? {
            status: 503,
            json: {
              error: {
                code: "warehouse_unavailable",
                message: "GPS data is temporarily unavailable",
              },
            },
          }
        : {
            json: {
              ...gpsFixture(),
              cells: [],
              locatedTrips: 0,
              shownTrips: 0,
              totalCells: 0,
            },
          },
    ),
  );
  await page.goto("/gps-map");
  await expect(
    page.getByText("GPS data is temporarily unavailable", { exact: false }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await ready(page);
  await expect(
    page.getByText("No recorded GPS locations match these filters.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("selected GPS area reaches Genie with the correct endpoint and coverage", async ({
  page,
}) => {
  await page.goto("/gps-map");
  await ready(page);
  await page
    .getByRole("button", { name: "Area 1, 60 pickups", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ask Genie about trip hotspots", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Ask a question about taxi data" }),
  ).toHaveValue(
    "Explain the spatial pattern and the selected area, including any limits of this map.",
  );
  await expect(
    page.getByText("GPS pickups", { exact: true }).first(),
  ).toBeVisible();
});

for (const width of [390, 1440])
  test(`Trip map fits ${width}px in light and dark themes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/gps-map");
    await ready(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/gps-${width}-light.png`,
      fullPage: true,
      animations: "disabled",
    });
    if (width < 768)
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Theme: System", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    if (width < 768)
      await page
        .getByRole("button", { name: "Close navigation", exact: true })
        .click();
    await ready(page);
    await page.screenshot({
      path: `test-results/gps-${width}-dark.png`,
      fullPage: true,
      animations: "disabled",
    });
  });
