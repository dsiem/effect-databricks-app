import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Trip, TripComment, TripCommentInput } from "../shared/domain";

const trip: Trip = {
  trip_id: "7b2c6ab2-6f7d-4f8a-a05f-d07e4eb84a19",
  pickup_at: "2016-01-20 09:42:00",
  dropoff_at: "2016-01-20 09:56:00",
  pickup_zip: "10001",
  dropoff_zip: "10019",
  distance: 3.2,
  fare: 18.5,
  duration: 14,
};
const otherTrip = { ...trip, trip_id: randomUUID() };
const author = { name: "Avery Morgan", email: "avery@example.test" };
const makeComment = (body: string): TripComment => ({
  id: randomUUID(),
  trip,
  body,
  author,
  created_at: "2026-11-14T10:00:00Z",
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/metadata", (route) =>
    route.fulfill({ json: { from: "2016-01-01", to: "2016-02-29", trips: 2 } }),
  );
  await page.route("**/api/me", (route) => route.fulfill({ json: author }));
  await page.route("**/api/trips**", (route) =>
    route.fulfill({
      json: { rows: [trip, otherTrip], total: 2, page: 1, pageSize: 25 },
    }),
  );
});

for (const width of [1440, 360]) {
  test(`trip comments stay attached after reload and distinguish similar records at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const stored: TripComment[] = [];
    await page.route("**/api/trip-comments**", (route) => {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON() as TripCommentInput;
        expect(input.trip).toEqual(trip);
        const saved = { ...input, author, created_at: "2026-11-14T10:00:00Z" };
        stored.push(saved);
        return route.fulfill({ json: saved });
      }
      const selected = JSON.parse(
        new URL(route.request().url()).searchParams.get("trip") ?? "null",
      ) as Trip;
      return route.fulfill({
        json: {
          rows: stored.filter(
            (comment) => comment.trip.trip_id === selected.trip_id,
          ),
          nextCursor: null,
        },
      });
    });
    await page.goto("/trips?zip=10001");
    const inspect = page.getByRole("button", {
      name: /^Details and comments for trip/,
    });
    await inspect.first().click();
    const panel = page.getByRole("dialog", {
      name: "Trip details",
      exact: true,
    });
    await expect(
      panel.getByRole("region", { name: "Selected trip" }),
    ).toContainText("$18.50");
    await expect(panel).toContainText("Start the conversation");
    await expect(
      panel.getByRole("button", { name: "Post comment", exact: true }),
    ).toBeDisabled();
    await panel
      .getByRole("textbox", { name: "Add a comment", exact: true })
      .fill("Check this fare against nearby trips.");
    await panel
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(
      panel.getByText("Check this fare against nearby trips.", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("status")).toHaveText("Comment posted");
    await expect(
      panel.getByRole("textbox", { name: "Add a comment" }),
    ).toHaveValue("");
    await expect(panel).toContainText(author.name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/trip-comments-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(inspect.first()).toBeFocused();
    await page.reload();
    await inspect.first().click();
    await expect(
      panel.getByText("Check this fare against nearby trips.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await inspect.nth(1).click();
    await expect(panel).toContainText("$18.50");
    await expect(panel).toContainText("Start the conversation");
    await expect(
      panel.getByText("Check this fare against nearby trips.", { exact: true }),
    ).toHaveCount(0);
    expect(stored).toHaveLength(1);
  });
}

test("drafts follow the trip ID when refreshed record details change", async ({
  page,
}) => {
  await page.route("**/api/trip-comments**", (route) =>
    route.fulfill({ json: { rows: [], nextCursor: null } }),
  );
  await page.goto("/trips");
  const inspect = page.getByRole("button", {
    name: /^Details and comments for trip/,
  });
  await inspect.first().click();
  const panel = page.getByRole("dialog", { name: "Trip details", exact: true });
  const field = panel.getByRole("textbox", { name: "Add a comment" });
  await field.fill("Keep investigating this trip");
  await page.keyboard.press("Escape");
  await page.route("**/api/trips**", (route) =>
    route.fulfill({
      json: {
        rows: [{ ...trip, fare: 25 }],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    }),
  );
  await page.getByRole("combobox", { name: "Sort trips" }).selectOption("fare");
  await expect(
    page.getByRole("cell", { name: "$25.00", exact: true }),
  ).toBeVisible();
  await inspect.first().click();
  await expect(panel).toContainText("$25.00");
  await expect(field).toHaveValue("Keep investigating this trip");
});

test("failed posts keep the draft across inspection and retry the same submission", async ({
  page,
}) => {
  let failing = true;
  const submitted: TripCommentInput[] = [];
  const stored: TripComment[] = [];
  await page.route("**/api/trip-comments**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { rows: stored, nextCursor: null } });
    const input = route.request().postDataJSON() as TripCommentInput;
    submitted.push(input);
    if (failing)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "lakebase_unavailable",
            message: "Comments are temporarily unavailable.",
          },
        },
      });
    const saved = { ...input, author, created_at: "2026-11-14T10:00:00Z" };
    stored.push(saved);
    return route.fulfill({ json: saved });
  });
  await page.goto("/trips");
  const inspect = page.getByRole("button", {
    name: /^Details and comments for trip/,
  });
  await inspect.first().click();
  const panel = page.getByRole("dialog", { name: "Trip details", exact: true });
  const field = panel.getByRole("textbox", {
    name: "Add a comment",
    exact: true,
  });
  await field.fill("My unsaved investigation");
  await panel
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Your draft is kept here",
  );
  await expect(field).toHaveValue("My unsaved investigation");
  await page.keyboard.press("Escape");
  await inspect.nth(1).click();
  await expect(field).toHaveValue("");
  await page.keyboard.press("Escape");
  await inspect.first().click();
  await expect(field).toHaveValue("My unsaved investigation");
  failing = false;
  await panel
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect(field).toHaveValue("");
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
});

test("loading older comments preserves the visible conversation through an outage", async ({
  page,
}) => {
  let failing = true;
  const recent = makeComment("Recent comment");
  const older = makeComment("Older comment");
  await page.route("**/api/trip-comments**", (route) => {
    const next = new URL(route.request().url()).searchParams.has("cursor");
    if (next && failing)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "lakebase_unavailable",
            message: "Try loading older comments again.",
          },
        },
      });
    return route.fulfill({
      json: {
        rows: next ? [older] : [recent],
        nextCursor: next
          ? null
          : { id: recent.id, createdAt: "2026-11-14T10:00:00.000000Z" },
      },
    });
  });
  await page.goto("/trips");
  await page
    .getByRole("button", { name: /^Details and comments for trip/ })
    .first()
    .click();
  const panel = page.getByRole("dialog", { name: "Trip details" });
  await panel.getByRole("button", { name: "Load older comments" }).click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Try loading older comments again.",
  );
  await expect(
    panel.getByText("Recent comment", { exact: true }),
  ).toBeVisible();
  failing = false;
  await panel.getByRole("button", { name: "Retry loading comments" }).click();
  await expect(panel.getByText("Older comment", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Recent comment", { exact: true }),
  ).toBeVisible();
});

test("typing while a comment posts keeps the new draft with a distinct retry identity", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const submitted: TripCommentInput[] = [];
  const stored: TripComment[] = [];
  await page.route("**/api/trip-comments**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { rows: stored, nextCursor: null } });
    const input = route.request().postDataJSON() as TripCommentInput;
    submitted.push(input);
    if (submitted.length === 1) await pending;
    const saved = { ...input, author, created_at: "2026-11-14T10:00:00Z" };
    stored.push(saved);
    return route.fulfill({ json: saved });
  });
  await page.goto("/trips");
  await page
    .getByRole("button", { name: /^Details and comments for trip/ })
    .first()
    .click();
  const panel = page.getByRole("dialog", { name: "Trip details" });
  const field = panel.getByRole("textbox", { name: "Add a comment" });
  await field.fill("First finding");
  await panel
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect.poll(() => submitted.length).toBe(1);
  await field.fill("Next finding, typed while posting");
  release();
  await expect(panel.getByRole("status")).toHaveText("Comment posted");
  await expect(field).toHaveValue("Next finding, typed while posting");
  await panel
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect(field).toHaveValue("");
  expect(submitted).toHaveLength(2);
  expect(submitted[1]?.id).not.toBe(submitted[0]?.id);
});
