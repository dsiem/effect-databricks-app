import { expect, test } from "@playwright/test";
import type { Note, NoteInput } from "../src/domain";

const filters = { from: "2016-01-10", to: "2016-01-20", zip: "10001" };
const query = new URLSearchParams(filters).toString();
const savedNote: Note = {
  id: "8aa0cc1a-6033-4fd0-9a61-908958570382",
  title: "Airport pickup patterns",
  body: "Compare this view with the next week.",
  filters: { to: "2016-02-20", zip: "11430" },
  pinned: false,
  version: 1,
  created_at: "2026-11-13T10:00:00Z",
  updated_at: "2026-11-13T10:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: {
        dataset: "samples.nyctaxi.trips",
        warehouse: false,
        genie: true,
        lakebase: false,
        capabilities: {
          warehouse: "unconfigured",
          genie: "unconfigured",
          lakebase: "unconfigured",
        },
        auth: "Test identity",
      },
    }),
  );
  await page.route("**/api/metadata", (route) =>
    route.fulfill({
      json: { from: "2016-01-01", to: "2016-02-29", trips: 21932 },
    }),
  );
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { rows: [savedNote], nextCursor: null } }),
  );
});

test("Explore saves applied filters in place, and saved views reopen on the current page", async ({
  page,
}) => {
  await page.goto(`/trips?${query}`);
  const tripFilters = page.getByRole("form", { name: "Trip filters" });
  // An unsubmitted ZIP edit must not silently change the saved view.
  await page
    .getByRole("textbox", { name: "Pickup ZIP code", exact: true })
    .fill("10002");
  await tripFilters
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Save this view",
    exact: true,
  });
  await expect(dialog).toContainText("Jan 10, 2016 – Jan 20, 2016");
  await expect(dialog).toContainText("Pickup ZIP 10001");
  await dialog
    .getByRole("textbox", { name: "View name", exact: true })
    .fill("Weekday pickups");
  await dialog
    .getByRole("textbox", { name: "Finding (optional)", exact: true })
    .fill("Review the unusually high fares.");
  let saved: NoteInput | undefined;
  await page.route("**/api/notes", (route) => {
    if (route.request().method() !== "PUT")
      return route.fulfill({ json: { rows: [savedNote], nextCursor: null } });
    saved = route.request().postDataJSON() as NoteInput;
    return route.fulfill({ json: { ...savedNote, ...saved, version: 1 } });
  });
  await dialog.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(saved?.filters).toEqual(filters);
  expect(saved?.body).toEqual("Review the unusually high fares.");
  await expect(page).toHaveURL(`/trips?${query}`);
  await expect(
    page.getByRole("textbox", { name: "Pickup ZIP code", exact: true }),
  ).toHaveValue("10002");
  await expect(page.getByRole("status")).toContainText(
    "Saved “Weekday pickups”",
  );
  await tripFilters
    .getByRole("button", { name: "Saved views", exact: true })
    .click();
  const views = page.getByRole("dialog", { name: "Saved views", exact: true });
  await expect(
    views.getByRole("heading", { name: savedNote.title }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/explore-saved-views.png",
    fullPage: true,
  });
  await views
    .getByRole("button", { name: `Open saved view for ${savedNote.title}` })
    .click();
  await expect(views).not.toBeVisible();
  await expect(page).toHaveURL("/trips?to=2016-02-20&zip=11430");
});

test("editing a saved note retains its original view and the visible action restores it", async ({
  page,
}) => {
  await page.goto(`/notebook?${query}`);
  await page
    .getByRole("button", { name: `Edit ${savedNote.title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit note" });
  await expect(dialog).toContainText("Through Feb 20, 2016");
  await expect(dialog).toContainText("Pickup ZIP 11430");
  await expect(dialog).toContainText("This note keeps its original filters");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const open = page.getByRole("button", {
    name: `Open saved view for ${savedNote.title}`,
  });
  await expect(open).toHaveText("Open saved view");
  await open.click();
  await expect(page).toHaveURL("/?to=2016-02-20&zip=11430");
});

test("Genie shows the actual view beside the composer and sends it with the question", async ({
  page,
}) => {
  const operation = { conversationId: "conversation", messageId: "message" };
  let submitted: unknown;
  await page.route("**/api/genie", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: operation });
  });
  await page.route("**/api/genie/conversation/messages/message", (route) =>
    route.fulfill({
      json: { ...operation, state: "completed", status: "COMPLETED" },
    }),
  );
  await page.route(
    "**/api/genie/conversation/messages/message/result",
    (route) =>
      route.fulfill({
        json: { ...operation, text: "Filtered trip count", queries: [] },
      }),
  );
  await page.goto(`/trips?${query}`);
  await page
    .locator("header")
    .getByRole("button", { name: "Ask Genie", exact: true })
    .click();
  const context = page.getByRole("region", {
    name: "Explore view for your next question",
  });
  await expect(context).toContainText("Jan 10, 2016 – Jan 20, 2016");
  await expect(context).toContainText("Pickup ZIP 10001");
  await expect(context).toContainText("Applied filters included.");
  await page
    .getByRole("textbox", { name: "Ask a question about taxi data" })
    .fill("Count trips");
  await page.screenshot({
    path: "test-results/explore-context-genie.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(
    page.getByText("Filtered trip count", { exact: true }),
  ).toBeVisible();
  expect(submitted).toMatchObject({
    content: "Count trips",
    filters,
    context: { page: "trips" },
  });
  await page.getByRole("button", { name: "Close Genie" }).click();
  await expect(page).toHaveURL(`/trips?${query}`);
});

for (const [search, dates] of [
  ["", "All dates"],
  ["from=2016-01-10", "From Jan 10, 2016"],
  ["to=2016-01-20", "Through Jan 20, 2016"],
]) {
  test(`context communicates unbounded filters: ${search || "all data"}`, async ({
    page,
  }) => {
    await page.goto(`/notebook${search ? `?${search}` : ""}`);
    const context = page.getByRole("region", {
      name: "Explore view for new notes",
    });
    await expect(context).toContainText(dates);
    await expect(context).toContainText("All pickup areas");
  });
}

test("context and saved-view actions fit a narrow mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ["notebook", "genie"]) {
    await page.goto(`/${path}?${query}`);
    const context = page.getByRole("region", { name: /^Explore view for/ });
    await expect(context).toContainText("Pickup ZIP 10001");
    await expect(context).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/explore-context-${path}-mobile.png`,
      fullPage: true,
    });
  }
});
