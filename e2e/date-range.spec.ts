import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/metadata", (route) =>
    route.fulfill({
      json: { from: "2016-01-03", to: "2016-02-25", trips: 21932 },
    }),
  );
});

async function openTrips(page: Page, query = "zip=10001") {
  const metadata = page.waitForResponse("**/api/metadata");
  await page.goto(`/trips?${query}`);
  await metadata;
}

for (const timezoneId of ["Europe/Berlin", "America/Los_Angeles"]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });

    test("applies native date inputs without shifting dates and restores them on reload", async ({
      page,
    }) => {
      await openTrips(page);
      const start = page.getByLabel("Pickup start date", { exact: true });
      const end = page.getByLabel("Pickup end date", { exact: true });
      await expect(start).toHaveAttribute("type", "date");
      await expect(end).toHaveAttribute("type", "date");
      await start.fill("2016-01-10");
      await end.fill("2016-02-20");
      await expect(page).toHaveURL(/\/trips\?zip=10001$/);
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(page).toHaveURL(
        /\/trips\?from=2016-01-10&to=2016-02-20&zip=10001$/,
      );
      await page.reload();
      await expect(start).toHaveValue("2016-01-10");
      await expect(end).toHaveValue("2016-02-20");
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(page).toHaveURL(/\/trips$/);
      await expect(start).toHaveValue("");
      await expect(end).toHaveValue("");
      await expect(page.getByLabel("Pickup ZIP code")).toHaveValue("");
    });
  });
}

test("clears dates while preserving the ZIP filter", async ({ page }) => {
  await openTrips(page, "from=2016-01-10&to=2016-01-20&zip=10001");
  await page.getByLabel("Pickup start date").fill("");
  await page.getByLabel("Pickup end date").fill("");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\?zip=10001$/);
  await expect(page.getByLabel("Pickup start date")).toHaveValue("");
  await expect(page.getByLabel("Pickup end date")).toHaveValue("");
});

for (const [query, from, to] of [
  ["from=2016-01-10", "2016-01-10", ""],
  ["to=2016-02-20", "", "2016-02-20"],
] as const) {
  test(`preserves an open range: ${query}`, async ({ page }) => {
    await openTrips(page, query);
    await expect(page.getByLabel("Pickup start date")).toHaveValue(from);
    await expect(page.getByLabel("Pickup end date")).toHaveValue(to);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(`/trips?${query}`);
  });
}

test("rejects dates outside the dataset bounds before applying filters", async ({
  page,
}) => {
  await openTrips(page);
  await page.getByLabel("Pickup start date").fill("2016-01-02");
  await page.getByLabel("Pickup end date").fill("2016-02-26");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\?zip=10001$/);
  await page.getByLabel("Pickup start date").fill("2016-01-03");
  await page.getByLabel("Pickup end date").fill("2016-02-25");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(
    /\/trips\?from=2016-01-03&to=2016-02-25&zip=10001$/,
  );
});

test("keeps date-order validation when dates are entered directly", async ({
  page,
}) => {
  await openTrips(page);
  await page.getByLabel("Pickup start date").fill("2016-02-20");
  await page.getByLabel("Pickup end date").fill("2016-01-10");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Invalid Explore filters" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "start date must be on or before the end date",
  );
});

test("native date inputs fit a mobile screen and apply a range", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openTrips(page);
  for (const label of ["Pickup start date", "Pickup end date"]) {
    const input = page.getByLabel(label);
    await expect(input).toBeVisible();
    const bounds = await input.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(360);
  }
  await page.getByLabel("Pickup start date").fill("2016-01-31");
  await page.getByLabel("Pickup end date").fill("2016-02-01");
  await page.screenshot({
    path: "test-results/date-range-mobile.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(
    /\/trips\?from=2016-01-31&to=2016-02-01&zip=10001$/,
  );
});
