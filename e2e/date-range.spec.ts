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

    test("selects a bounded range and applies the same calendar dates to the URL", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openTrips(page);
      const trigger = page.getByRole("button", {
        name: "Pickup date range: Select date range",
      });
      await trigger.click();
      const picker = page.getByRole("dialog", { name: "Pickup dates" });
      const january = picker.getByRole("grid", { name: "January 2016" });
      const february = picker.getByRole("grid", { name: "February 2016" });
      await expect(january).toBeVisible();
      await expect(february).toBeVisible();
      await expect(
        january.getByRole("button", { name: /January 2, 2016/ }),
      ).toBeDisabled();
      await expect(
        february.getByRole("button", { name: /February 26, 2016/ }),
      ).toBeDisabled();
      await january.getByRole("button", { name: /January 10, 2016/ }).click();
      await february.getByRole("button", { name: /February 20, 2016/ }).click();
      await expect(page).toHaveURL(/\/trips\?zip=10001$/);
      await page.screenshot({
        path: `test-results/date-range-${timezoneId.replace("/", "-")}.png`,
        animations: "disabled",
      });
      await picker.getByRole("button", { name: "Done", exact: true }).click();
      await expect(picker).not.toBeVisible();
      const selected = page.getByRole("button", {
        name: "Pickup date range: Jan 10, 2016 – Feb 20, 2016",
      });
      await expect(selected).toBeFocused();
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(page).toHaveURL(
        /\/trips\?from=2016-01-10&to=2016-02-20&zip=10001$/,
      );
      await page.reload();
      await expect(selected).toBeVisible();
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(page).toHaveURL(/\/trips$/);
      await expect(trigger).toBeVisible();
    });
  });
}

test("clears dates while preserving the ZIP filter", async ({ page }) => {
  await openTrips(page, "from=2016-01-10&to=2016-01-20&zip=10001");
  await page.getByRole("button", { name: /^Pickup date range:/ }).click();
  const picker = page.getByRole("dialog", { name: "Pickup dates" });
  await picker.getByRole("button", { name: "Clear dates" }).click();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\?zip=10001$/);
  await expect(
    page.getByRole("button", { name: "Pickup date range: Select date range" }),
  ).toBeVisible();
});

for (const [query, label] of [
  ["from=2016-01-10", "From Jan 10, 2016"],
  ["to=2016-02-20", "Through Feb 20, 2016"],
]) {
  test(`preserves an open range: ${query}`, async ({ page }) => {
    await openTrips(page, query);
    await expect(
      page.getByRole("button", { name: `Pickup date range: ${label}` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(`/trips?${query}`);
  });
}

test("mobile picker fits the screen and supports keyboard selection and dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openTrips(page);
  const trigger = page.getByRole("button", { name: /^Pickup date range:/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Pickup dates" });
  await expect(picker.getByRole("grid")).toHaveCount(1);
  const day = picker.getByRole("button", { name: /January 10, 2016/ });
  await day.click();
  const grid = picker.getByRole("grid");
  await grid.focus();
  await page.keyboard.press("ArrowRight");
  const next = picker.getByRole("gridcell", { name: /January 11, 2016/ });
  await expect(grid).toBeFocused();
  await expect(grid).toHaveAttribute(
    "aria-activedescendant",
    (await next.getAttribute("id")) ?? "",
  );
  await page.keyboard.press("Space");
  await page.screenshot({
    path: "test-results/date-range-mobile.png",
    animations: "disabled",
  });
  const bounds = await picker.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(360);
  await page.keyboard.press("Escape");
  await expect(picker).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(
    /\/trips\?from=2016-01-10&to=2016-01-11&zip=10001$/,
  );
});

test("keyboard selection crosses a month boundary without losing the calendar cursor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openTrips(page, "from=2016-01-31&to=2016-01-31&zip=10001");
  await page.getByRole("button", { name: /^Pickup date range:/ }).click();
  const picker = page.getByRole("dialog", { name: "Pickup dates" });
  const grid = picker.getByRole("grid");
  await expect(grid).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(grid).toHaveAccessibleName("February 2016");
  const day = picker.getByRole("gridcell", { name: /February 1, 2016/ });
  await expect(grid).toHaveAttribute(
    "aria-activedescendant",
    (await day.getAttribute("id")) ?? "",
  );
  await page.keyboard.press("Space");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(
    /\/trips\?from=2016-02-01&to=2016-02-01&zip=10001$/,
  );
});
