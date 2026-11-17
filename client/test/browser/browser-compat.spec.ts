import { tripDetails } from "../trip-fixture";
import { expect, test } from "@playwright/test";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const trip = {
  trip_id: "stable-trip",
  pickup_at: "2016-01-11 18:00:00",
  dropoff_at: "2016-01-11 18:14:00",
  pickup_zip: "10001",
  dropoff_zip: "10003",
  distance: 2.8,
  duration: 14,
  details: tripDetails,
  fare: 13.42,
};

test("saving views, posting comments, and asking Genie work without crypto.randomUUID", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const created: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/status")
      return route.fulfill({
        json: {
          dataset: "samples.nyctaxi.trips",
          warehouse: true,
          genie: true,
          lakebase: true,
          capabilities: {
            warehouse: "available",
            genie: "available",
            lakebase: "available",
          },
          auth: "Test identity",
        },
      });
    if (path === "/api/metadata")
      return route.fulfill({
        json: { from: "2016-01-01", to: "2016-02-29", trips: 1 },
      });
    if (path === "/api/me")
      return route.fulfill({
        json: { name: "Analyst", email: "analyst@example.com" },
      });
    if (path === "/api/trips")
      return route.fulfill({
        json: { rows: [trip], total: 1, page: 1, pageSize: 25 },
      });
    if (path === "/api/saved-views") {
      if (request.method() === "GET")
        return route.fulfill({ json: { rows: [], nextCursor: null } });
      const input = request.postDataJSON();
      created.push(input.id);
      return route.fulfill({
        json: {
          ...input,
          version: 1,
          pinned: false,
          created_at: "2026-11-14T10:00:00Z",
          updated_at: "2026-11-14T10:00:00Z",
        },
      });
    }
    if (path === "/api/trip-comments") {
      if (request.method() === "GET")
        return route.fulfill({ json: { rows: [], nextCursor: null } });
      const input = request.postDataJSON();
      created.push(input.id);
      return route.fulfill({
        json: {
          ...input,
          author: { name: "Analyst", email: "analyst@example.com" },
          created_at: "2026-11-14T10:00:00Z",
        },
      });
    }
    const operation = { conversationId: "conversation", messageId: "message" };
    if (path === "/api/genie") return route.fulfill({ json: operation });
    if (path.endsWith("/result"))
      return route.fulfill({
        json: {
          ...operation,
          text: "There is one trip in this view.",
          queries: [],
        },
      });
    if (path === "/api/genie/conversation/messages/message")
      return route.fulfill({
        json: { ...operation, state: "completed", status: "COMPLETED" },
      });
    return route.fulfill({
      status: 404,
      json: { message: "Unexpected test request" },
    });
  });
  await page.goto("/trips");
  await page
    .getByRole("form", { name: "Trip filters" })
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Save this view",
    exact: true,
  });
  await editor
    .getByLabel("View name", { exact: true })
    .fill("UUID compatibility");
  await editor.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page
    .getByRole("button", { name: /^Details and comments for trip/ })
    .click();
  const inspector = page.getByRole("dialog", {
    name: "Trip details",
    exact: true,
  });
  await inspector
    .getByLabel("Add a comment", { exact: true })
    .fill("Review this fare.");
  await inspector
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect(inspector.getByRole("status")).toHaveText("Comment posted");
  await page.keyboard.press("Escape");
  await page
    .locator("header")
    .getByRole("button", { name: "Ask Genie", exact: true })
    .click();
  const genie = page.getByRole("dialog", { name: "Genie", exact: true });
  await genie.getByRole("textbox").fill("Count trips");
  await genie
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(
    genie.getByText("There is one trip in this view.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("metrocab.genie.v1") ?? "[]")[0]
            ?.id,
      ),
    )
    .toMatch(uuid);
  expect(created).toHaveLength(2);
  for (const id of created) expect(id).toMatch(uuid);
  expect(new Set(created).size).toBe(created.length);
  expect(errors).toEqual([]);
});
