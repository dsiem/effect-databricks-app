import { expect, test } from "@playwright/test";
import type { Overview } from "../shared/domain";

const overview: Overview = {
  summary: {
    trips: 21932,
    revenue: 250000,
    avg_fare: 12,
    avg_distance: 3,
    avg_duration: 15,
  },
  daily: [],
  hourly: [],
  zones: [
    "10001",
    "10019",
    "10022",
    "10016",
    "10003",
    "10036",
    "10017",
    "10023",
    "10011",
    "11430",
  ].map((zip, index) => ({
    zip,
    trips: 3000 - index * 250,
    revenue: 20000,
    avg_fare: 12,
  })),
  queriedAt: "2026-11-13T10:00:00Z",
};

test.beforeEach(async ({ page }) => {
  // Boundary rendering and selection must also work without street-tile access.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/overview*", (route) =>
    route.fulfill({ json: overview }),
  );
  await page.route("**/api/metadata", (route) =>
    route.fulfill({
      json: { from: "2016-01-01", to: "2016-02-29", trips: 21932 },
    }),
  );
});

test("wheel zoom changes the map without scrolling the page", async ({
  page,
}) => {
  await page.goto("/map");
  const map = page.getByRole("region", { name: "Pickup activity map" });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await map.scrollIntoViewIfNeeded();
  const scale = map.locator(".maplibregl-ctrl-scale");
  const before = await scale.textContent();
  const scroll = await page.evaluate(() => scrollY);
  await map.hover();
  await page.mouse.wheel(0, -500);
  await expect(scale).not.toHaveText(before ?? "");
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
});

test("a GPU-rendered ZIP area shows its trip count and filters on click", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/map?from=2016-01-10");
  const map = page.getByRole("region", { name: "Pickup activity map" });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const box = await map.boundingBox();
  if (!box) throw new Error("Map is not visible");
  const position = { x: box.width * 0.4, y: box.height * 0.5 };
  await map.hover({ position });
  await expect(map.locator(".map-tooltip")).toContainText(
    /ZIP .+ · [\d,]+ trips/,
  );
  await map.click({ position });
  await expect(page).toHaveURL(/from=2016-01-10&zip=\d{5}/);
  await expect(map).toHaveAttribute("data-map-ready", "true");
  expect(errors).toEqual([]);
});

test("filter updates preserve the camera and reuse the geographic boundaries", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let boundaryRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/nyc-zips.geojson")
      boundaryRequests++;
  });
  await page.goto("/map");
  const map = page.getByRole("region", { name: "Pickup activity map" });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const scale = map.locator(".maplibregl-ctrl-scale");
  const before = await scale.textContent();
  await map.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(scale).not.toHaveText(before ?? "");
  const zoomed = await scale.textContent();
  await page
    .getByRole("button", { name: "Rank 10, ZIP 11430, 750 trips", exact: true })
    .click();
  await expect(page).toHaveURL(/zip=11430/);
  await expect(map).toHaveAttribute("data-map-query", "zip=11430");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(scale).toHaveText(zoomed ?? "");
  expect(boundaryRequests).toBe(1);
});

test("theme changes recolor the rendered layer without replacing the map", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/map");
  const map = page.getByRole("region", { name: "Pickup activity map" });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const zoom = map.getByRole("button", { name: "Zoom in", exact: true });
  await expect(zoom).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const canvas = map.locator("canvas");
  const before = await canvas.screenshot();
  await page
    .getByRole("button", { name: "Theme: System", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(zoom).toHaveCSS("background-color", "rgb(27, 32, 44)");
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);
  await expect(map).toHaveAttribute("data-map-ready", "true");
});

test("the map follows sidebar and viewport resizing", async ({ page }) => {
  await page.goto("/map");
  const map = page.getByRole("region", { name: "Pickup activity map" });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const canvas = map.locator("canvas");
  const width = await canvas.evaluate((element) => element.clientWidth);
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect
    .poll(() => canvas.evaluate((element) => element.clientWidth))
    .toBeGreaterThan(width);
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect
    .poll(() =>
      map.evaluate((element) => {
        const canvas = element.querySelector("canvas");
        return (
          !!canvas &&
          canvas.clientWidth === element.clientWidth &&
          canvas.clientHeight === element.clientHeight
        );
      }),
    )
    .toBe(true);
  const scale = map.locator(".maplibregl-ctrl-scale");
  const before = await scale.textContent();
  await map.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(scale).not.toHaveText(before ?? "");
});

test("filters changed while geography loads are applied to the first rendered frame", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/nyc-zips.geojson", async (route) => {
    requested = true;
    await pending;
    await route.continue();
  });
  await page.route("**/api/overview*", (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get("zip") === "11430"
          ? {
              ...overview,
              zones: overview.zones.slice(-1),
              summary: { ...overview.summary, trips: 750 },
            }
          : overview,
    }),
  );
  await page.goto("/map");
  await expect.poll(() => requested).toBe(true);
  await page
    .getByRole("button", { name: "Rank 10, ZIP 11430, 750 trips", exact: true })
    .click();
  await expect(page).toHaveURL(/zip=11430/);
  await expect(
    page.getByRole("heading", { name: "Pickup ZIP 11430", exact: true }),
  ).toBeVisible();
  release();
  const map = page.getByRole("region", { name: "Pickup activity map" });
  await expect(map).toHaveAttribute("data-map-query", "zip=11430");
  await expect(
    page.getByText("750 mapped trips", { exact: true }),
  ).toBeVisible();
});

test("leaving and returning creates one interactive map with no stale callbacks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/map");
  for (let visit = 0; visit < 2; visit++) {
    const map = page.getByRole("region", { name: "Pickup activity map" });
    await expect(map).toHaveAttribute("data-map-ready", "true");
    await expect(map.locator("canvas")).toHaveCount(1);
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(map).toHaveCount(0);
    await page.getByRole("link", { name: "Pickup map", exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test("unavailable boundaries offer retry and clean up the failed mount", async ({
  page,
}) => {
  await page.route("**/nyc-zips.geojson", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/map");
  await expect(
    page.getByText("Unable to load NYC geographic boundaries. Try again."),
  ).toBeVisible();
  await page.unroute("**/nyc-zips.geojson");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Pickup activity map" }),
  ).toHaveAttribute("data-map-ready", "true");
});

test("invalid boundary ZIPs are rejected before rendering and can be retried", async ({
  page,
}) => {
  await page.route("**/nyc-zips.geojson", (route) =>
    route.fulfill({
      json: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              label: "10001",
              modzcta: "10001",
              zcta: "10001, invalid",
            },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-74, 40.7],
                  [-74, 40.8],
                  [-73.9, 40.8],
                  [-74, 40.7],
                ],
              ],
            },
          },
        ],
      },
    }),
  );
  await page.goto("/map");
  await expect(
    page.getByText("Unable to load NYC geographic boundaries. Try again."),
  ).toBeVisible();
  await page.unroute("**/nyc-zips.geojson");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Pickup activity map" }),
  ).toHaveAttribute("data-map-ready", "true");
});

test("missing WebGL is reported as a renderer failure", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...options: unknown[]) {
        return type === "webgl" || type === "webgl2"
          ? null
          : Reflect.apply(getContext, this, [type, ...options]);
      },
    });
  });
  await page.goto("/map");
  await expect(
    page.getByText(
      "Unable to render the pickup map. Check WebGL support and try again.",
    ),
  ).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`map and padded ranking fit at ${width}px, and ranking filters the view`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/map?from=2016-01-10");
    const ranking = page.getByRole("list", { name: "Pickup ZIP ranking" });
    await expect(ranking.getByRole("button")).toHaveCount(10);
    const tenth = ranking.getByRole("button", {
      name: "Rank 10, ZIP 11430, 750 trips",
      exact: true,
    });
    await tenth.hover();
    // Content stays inset even when the row's hover/selection background appears.
    const insets = await tenth.evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      const rank = row.firstElementChild?.getBoundingClientRect();
      const content = row.lastElementChild?.getBoundingClientRect();
      return {
        left: (rank?.left ?? 0) - bounds.left,
        right: bounds.right - (content?.right ?? 0),
        top: (content?.top ?? 0) - bounds.top,
        bottom: bounds.bottom - (content?.bottom ?? 0),
      };
    });
    for (const inset of Object.values(insets))
      expect(inset).toBeGreaterThanOrEqual(8);
    const mapCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.locator(".map-panel") });
    const footer = mapCard
      .getByText("Modified ZIP areas · geographic aggregation")
      .locator("..");
    const cardBox = await mapCard.boundingBox();
    const footerBox = await footer.boundingBox();
    expect(
      Math.abs(
        (cardBox?.y ?? 0) +
          (cardBox?.height ?? 0) -
          (footerBox?.y ?? 0) -
          (footerBox?.height ?? 0),
      ),
    ).toBeLessThan(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/map-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await tenth.click();
    await expect(page).toHaveURL(/from=2016-01-10&zip=11430/);
    await expect(tenth).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("Pickup ZIP 11430", { exact: true }),
    ).toBeVisible();
    // Keyboard activation uses the same filter action.
    const first = ranking.getByRole("button").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/from=2016-01-10&zip=10001/);
  });
}
