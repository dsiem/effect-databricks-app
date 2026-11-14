import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const overview = {
  summary: {
    trips: 50,
    revenue: 600,
    avg_fare: 12,
    avg_distance: 3,
    avg_duration: 15,
  },
  daily: [
    { day: "2016-01-01", trips: 20, revenue: 200 },
    { day: "2016-01-02", trips: 30, revenue: 400 },
  ],
  hourly: [
    { hour: 8, trips: 20, avg_fare: 10 },
    { hour: 18, trips: 30, avg_fare: 13.33 },
  ],
  zones: [{ zip: "10001", trips: 50, revenue: 600, avg_fare: 12 }],
  queriedAt: "2026-11-14T10:00:00Z",
};
const trip = {
  trip_id: "stable-trip",
  pickup_at: "2016-01-01 10:00:00",
  dropoff_at: "2016-01-01 10:15:00",
  pickup_zip: "10001",
  dropoff_zip: "10019",
  distance: 3,
  fare: 12,
  duration: 15,
};

test("overview charts, navigation, paging, CSV download, and browser history work through the runtime", async ({
  page,
}) => {
  await page.route("**/api/overview**", (route) =>
    route.fulfill({ json: overview }),
  );
  await page.route("**/api/trips**", (route) =>
    route.fulfill({
      json: {
        rows: [trip],
        total: 50,
        page: Number(new URL(route.request().url()).searchParams.get("page")),
        pageSize: 25,
      },
    }),
  );
  await page.goto("/?zip=10001");
  await expect(page.getByText("$600", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Trips by pickup date" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Trips", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Revenue", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("img", { name: "Fare revenue by pickup date" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Trip explorer", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this page" }).click();
  const csv = await download;
  expect(csv.suggestedFilename()).toBe("taxi-trips-page-1.csv");
  const path = await csv.path();
  expect(path).not.toBeNull();
  const text = await readFile(path ?? "", "utf8");
  expect(text.split("\r\n")).toEqual([
    "trip_id,pickup_at,dropoff_at,pickup_zip,dropoff_zip,distance,fare,duration",
    '"stable-trip","2016-01-01 10:00:00","2016-01-01 10:15:00","10001","10019","3","12","15"',
  ]);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL("/trips?zip=10001");
  await expect(
    page.getByRole("heading", { name: "Trip records", exact: true }),
  ).toBeVisible();
});

test("late trip responses cannot overwrite a newer filter selection", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/trips**", async (route) => {
    const zip = new URL(route.request().url()).searchParams.get("zip");
    if (zip === "10001") {
      started = true;
      await pending;
    }
    await route.fulfill({
      json: {
        rows: [{ ...trip, pickup_zip: zip }],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
  });
  await page.goto("/trips?zip=10001");
  await expect.poll(() => started).toBe(true);
  await page.getByRole("textbox", { name: "Pickup ZIP code" }).fill("10002");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "10002 → 10019", exact: true }),
  ).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/trips" &&
      new URL(response.url()).searchParams.get("zip") === "10001",
  );
  release();
  await (await oldResponse).finished();
  await expect(
    page.getByRole("cell", { name: "10001 → 10019", exact: true }),
  ).toHaveCount(0);
});

test("notebook creates, edits, reloads, and deletes versioned notes with their saved filters", async ({
  page,
}) => {
  const stored: import("../src/domain").Note[] = [];
  await page.route("**/api/notes**", (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const input = request.postDataJSON() as import("../src/domain").NoteInput;
      expect(input.filters).toEqual({ zip: "10001" });
      const previous = stored.find((note) => note.id === input.id);
      expect(input.version).toBe(previous?.version ?? null);
      const saved = {
        ...input,
        version: (input.version ?? 0) + 1,
        pinned: false,
        created_at: "2026-11-14T10:00:00Z",
        updated_at: "2026-11-14T10:00:00Z",
      };
      stored.splice(0, stored.length, saved);
      return route.fulfill({ json: saved });
    }
    if (request.method() === "DELETE") {
      expect(new URL(request.url()).searchParams.get("version")).toBe("2");
      stored.splice(0);
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: { rows: stored, nextCursor: null } });
  });
  await page.goto("/notebook?zip=10001");
  const newNote = page.getByRole("button", { name: "New note", exact: true });
  await newNote.click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Fare review");
  await page
    .getByRole("textbox", { name: "Your notes", exact: true })
    .fill("Initial finding");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fare review", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Edit Fare review", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Your notes", exact: true })
    .fill("Updated finding");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByText("Updated finding", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete Fare review", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete this note?", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No saved notes", exact: true }),
  ).toBeVisible();
  await expect(newNote).toBeFocused();
});

test("modal backdrop dismissal restores the opener and page scrolling", async ({
  page,
}) => {
  await page.goto("/notebook");
  const trigger = page.getByRole("button", { name: "New note", exact: true });
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "New note", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  await page.mouse.click(4, 4);
  await expect(
    page.getByRole("dialog", { name: "New note", exact: true }),
  ).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("recovered Genie answers render Markdown safely and copy the generated SQL", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const reply = {
    conversationId: "conversation",
    messageId: "message",
    text: '**Key finding**\n\n[Reference](https://example.com/report)\n\n[Unsafe](javascript:alert(1))\n\n<img src=x onerror="document.body.dataset.executed=1">',
    queries: [
      {
        sql: "SELECT COUNT(*) FROM samples.nyctaxi.trips",
        description: "Trip count",
        columns: ["trips"],
        rows: [["50"]],
        truncated: false,
      },
    ],
  };
  await page.addInitScript(
    (reply) =>
      sessionStorage.setItem(
        "metrocab.genie.v1",
        JSON.stringify([
          {
            id: "saved-turn",
            question: "Count trips",
            state: "complete",
            reply,
          },
        ]),
      ),
    reply,
  );
  await page.goto("/genie");
  await expect(page.locator("strong")).toHaveText("Key finding");
  await expect(
    page.getByRole("link", { name: "Reference", exact: true }),
  ).toHaveAttribute("href", "https://example.com/report");
  await expect(
    page.getByRole("link", { name: "Unsafe", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("main img")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.body.dataset.executed),
  ).toBeUndefined();
  await page.getByText("View generated SQL", { exact: true }).click();
  await page.getByRole("button", { name: "Copy SQL", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    reply.queries[0]?.sql,
  );
});
