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
  const map = page.locator(".leaflet-container");
  const area = page.locator(".leaflet-overlay-pane path").first();
  await expect(area).toBeVisible();
  await map.scrollIntoViewIfNeeded();
  const before = await area.boundingBox();
  const scroll = await page.evaluate(() => scrollY);
  await map.hover();
  await page.mouse.wheel(0, -500);
  await expect
    .poll(async () => (await area.boundingBox())?.width ?? 0)
    .toBeGreaterThan((before?.width ?? 0) * 1.5);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
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
