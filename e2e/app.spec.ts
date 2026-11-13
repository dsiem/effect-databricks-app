import { expect, test } from "@playwright/test";

test("warehouse analytics, filtering, sorting, pagination, CSV and geography", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Trip overview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Total fare revenue", { exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await page.getByRole("tab", { name: "Trips", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Revenue", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", {
      name: "Fare revenue by pickup date",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("heading", { name: "Trips by pickup date", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Pickup ZIP code", { exact: true }).fill("10001");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/zip=10001/);
  await page.getByRole("link", { name: "Trip explorer", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("tbody tr").first()).toContainText("10001");
  await page.getByRole("combobox", { name: "Sort trips" }).click();
  await page.getByRole("option", { name: "Highest fare", exact: true }).click();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await page.getByLabel("Next page").click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this page" }).click();
  expect((await download).suggestedFilename()).toBe("taxi-trips-page-2.csv");
  await page.getByRole("link", { name: "Pickup map", exact: true }).click();
  await expect(page.locator(".leaflet-overlay-pane path").first()).toBeVisible({
    timeout: 120_000,
  });
  await page.screenshot({
    path: "test-results/pickup-map.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    page.getByText("Total fare revenue", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Open navigation").click();
  await expect(
    page.getByRole("link", { name: "Analyst notebook", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Close navigation", { exact: true }).last().click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).not.toBeInViewport();
  await page.screenshot({
    path: "test-results/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Lakebase notes survive reload and support editing, saved filters and deletion", async ({
  page,
}) => {
  await page.goto("/notebook?zip=10001");
  await expect(
    page.getByRole("heading", { name: "Analyst notebook" }),
  ).toBeVisible();
  const title = `Browser verification ${Date.now()}`;
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(title);
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Your notes", exact: true })
    .fill("A temporary note to verify real Lakebase persistence.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByLabel(`Edit ${title}`, { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Your notes", exact: true })
    .fill("Updated and persisted.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByText("Updated and persisted.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(`Open saved view for ${title}`, { exact: true })
    .click();
  await expect(page).toHaveURL(/zip=10001/);
  await page.goto("/notebook");
  await page.getByLabel(`Delete ${title}`, { exact: true }).click();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(0);
});

test("Genie renders real answers, result tables, generated SQL and follow-up context", async ({
  page,
}) => {
  await page.goto("/genie");
  await page
    .getByLabel("Ask a question about taxi data")
    .fill(
      "How many trips are in samples.nyctaxi.trips? Return a single total_trips column.",
    );
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "21932", exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  await page.getByText("View generated SQL", { exact: true }).click();
  await expect(page.locator("pre")).toContainText(/SELECT/i);
  await page
    .getByLabel("Ask a question about taxi data")
    .fill("Now show the top 3 pickup ZIP codes by trip count.");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.getByRole("table")).toHaveCount(2, { timeout: 120_000 });
  await page.screenshot({
    path: "test-results/genie.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Example queries" }),
  ).toBeVisible();
});
