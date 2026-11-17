import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import type { TripSummary } from "../shared/domain";
import {
  compareTrips,
  matchesTrip,
  retentionCharge,
  type TripQuery,
  tripQueryKey,
} from "../shared/trip-dataset";

const tripRows = (length: number): TripSummary[] =>
  Array.from({ length }, (_, i) => ({
    trip_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    pickup_at: `2016-01-${i % 2 ? "31" : "30"} 23:59:59.999999`,
    dropoff_at: "2016-02-01 00:10:00.000000",
    pickup_zip: i % 2 ? "10001" : null,
    dropoff_zip: "10002",
    distance: i % 20,
    fare: i,
    duration: 10,
  }));
const all = tripRows(2000);
const metadata = { from: "2016-01-01", to: "2016-02-29", trips: 2000 };
async function fixtures(
  context: import("@playwright/test").BrowserContext,
  server = false,
  source = all,
  windowRows = 200,
) {
  const requests: Array<{ path: string; input: unknown }> = [];
  const reply = (query: TripQuery, start = 0) => {
    const sorted = source
      .filter((row) => matchesTrip(row, query.filters))
      .sort((a, b) => compareTrips(a, b, query.sort));
    const rows = server ? sorted.slice(start, start + windowRows) : sorted;
    return {
      schemaVersion: 1,
      query,
      queryKey: tripQueryKey(query),
      snapshot: "snapshot-7",
      datasetKey: `7:${tripQueryKey(query)}`,
      total: sorted.length,
      loaded: rows.length,
      rows,
      budget: { rows: 20000, bytes: 33554432 },
      retainedBytes: retentionCharge(rows),
      ...(server
        ? {
            scope: "server-window",
            start,
            previous: start ? String(Math.max(0, start - windowRows)) : null,
            next:
              start + rows.length < sorted.length
                ? String(start + rows.length)
                : null,
          }
        : { scope: "complete" }),
    };
  };
  await context.route("**/api/metadata", (route) =>
    route.fulfill({ json: { ...metadata, trips: source.length } }),
  );
  await context.route("**/api/trip-datasets**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const input = route.request().postDataJSON();
    requests.push({ path, input });
    if (path.endsWith("/detail")) {
      const row = source.find((r) => r.trip_id === input.tripId);
      await route.fulfill({
        json: { ...row, pickup_zip: row?.pickup_zip ?? "Unknown" },
      });
    } else if (path.endsWith("/window"))
      await route.fulfill({ json: reply(input.query, Number(input.cursor)) });
    else {
      if (input.sort === "distance")
        await new Promise((resolve) => setTimeout(resolve, 200));
      const data = reply(input);
      await route.fulfill({ json: data });
    }
  });
  await context.route("**/api/trip-comments**", (route) =>
    route.fulfill({ json: { rows: [], nextCursor: null } }),
  );
  await context.route("**/api/trip-comment-counts**", (route) => {
    const ids: string[] = JSON.parse(
      new URL(route.request().url()).searchParams.get("tripIds") ?? "[]",
    );
    return route.fulfill({
      json: Object.fromEntries(ids.map((id) => [id, 0])),
    });
  });
  return requests;
}

test("trip explorer bounds rendered rows, sorts locally and restores inspector focus", async ({
  page,
  context,
}) => {
  const requests = await fixtures(context);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/trips-preview");
  await expect(
    page.getByRole("status").filter({ hasText: "Complete result" }),
  ).toBeVisible();
  const grid = page.locator("#trip-virtual-grid");
  await expect(grid.locator("tr[data-trip-id]").first()).toBeVisible();
  await page.getByRole("combobox", { name: "Sort trips" }).selectOption("fare");
  await expect(grid.locator("tr[data-trip-id]").first()).toHaveAttribute(
    "data-trip-id",
    all[1999]?.trip_id ?? "",
  );
  expect(requests.filter((r) => r.path === "/api/trip-datasets")).toHaveLength(
    1,
  );
  const scroller = grid.locator(".trip-grid-scroll");
  await scroller.evaluate((element) => {
    element.scrollTop = 80000;
  });
  await expect
    .poll(async () => grid.locator("tr[data-trip-id]").count())
    .toBeLessThan(81);
  await expect(grid.locator("tr[data-trip-id]").first()).not.toHaveAttribute(
    "data-trip-id",
    all[1999]?.trip_id ?? "",
  );
  const inspect = grid.getByRole("button", { name: /Inspect trip/ }).first();
  await inspect.focus();
  await page.keyboard.press("ArrowDown");
  const selectedId = await page
    .locator("tr:has(button:focus)")
    .getAttribute("data-trip-id");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Trip details" }),
  ).toBeVisible();
  const detail = requests.find((r) => r.path.endsWith("/detail"));
  expect(detail?.input).toEqual({ tripId: selectedId, snapshot: "snapshot-7" });
  await page.keyboard.press("Escape");
  await expect(
    grid.locator(`tr[data-trip-id="${selectedId}"] button`),
  ).toBeFocused();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(grid).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("server scrolling evicts windows, retains rows during replacement and rejects obsolete results", async ({
  page,
  context,
}) => {
  const requests = await fixtures(context, true);
  await page.goto("/trips-preview");
  await expect(
    page.getByRole("status").filter({ hasText: "Server scrolling" }),
  ).toBeVisible();
  const grid = page.locator("#trip-virtual-grid");
  const scroller = grid.locator(".trip-grid-scroll");
  for (let i = 0; i < 6; i++) {
    const previous = requests.filter((r) => r.path.endsWith("/window")).length;
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => requests.filter((r) => r.path.endsWith("/window")).length)
      .toBeGreaterThan(previous);
    await expect(
      page.getByRole("status").filter({ hasText: "Server scrolling" }),
    ).toBeVisible();
  }
  expect(await grid.locator("tr[data-trip-id]").count()).toBeLessThan(81);
  const retained = await grid.locator(".trip-grid-controls span").textContent();
  const windowBounds = retained?.match(/(\d+)–(\d+) loaded/);
  expect(Number(windowBounds?.[1])).toBeGreaterThan(1);
  expect(
    Number(windowBounds?.[2]) - Number(windowBounds?.[1]) + 1,
  ).toBeLessThanOrEqual(600);
  const current = await grid
    .locator("tr[data-trip-id]")
    .first()
    .getAttribute("data-trip-id");
  await page
    .getByRole("combobox", { name: "Sort trips" })
    .selectOption("distance");
  await expect(grid.locator("tr[data-trip-id]").first()).toHaveAttribute(
    "data-trip-id",
    current ?? "",
  );
  await page.getByRole("combobox", { name: "Sort trips" }).selectOption("fare");
  await expect(grid.locator("tr[data-trip-id]").first()).toHaveAttribute(
    "data-trip-id",
    all[1999]?.trip_id ?? "",
  );
  await page.waitForTimeout(250);
  await expect(grid.locator("tr[data-trip-id]").first()).toHaveAttribute(
    "data-trip-id",
    all[1999]?.trip_id ?? "",
  );
});

test("empty and failed datasets leave a usable query control at narrow width and larger text", async ({
  page,
  context,
}) => {
  await fixtures(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trips-preview?from=2017-01-01");
  await page.addStyleTag({ content: "html { font-size: 20px; }" });
  await expect(
    page.getByText("No trips match these filters.", { exact: true }),
  ).toBeVisible();
  await context.route("**/api/trip-datasets", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: "warehouse_unavailable", message: "Unavailable" },
      },
    }),
  );
  await page.getByRole("button", { name: "Reload query" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Unable to load trips" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Sort trips" }),
  ).toBeEnabled();
});

test("large server slices load 5,000 rows initially and retain a bounded scrolling cache", async ({
  page,
  context,
}) => {
  const requests = await fixtures(context, true, tripRows(22051), 5000);
  await page.goto("/trips-preview");
  const grid = page.locator("#trip-virtual-grid");
  const scroller = grid.locator(".trip-grid-scroll");
  const label = grid.locator(".trip-grid-controls span");
  await expect(label).toHaveText("1–5000 loaded · 22,051 matching trips");
  await expect(
    page.getByRole("status").filter({ hasText: "Server scrolling" }),
  ).toBeVisible();
  await expect(
    grid.getByRole("button", {
      name: "Export complete matching result",
      exact: true,
    }),
  ).toBeHidden();
  const initialId = await grid
    .locator("tr[data-trip-id]")
    .first()
    .getAttribute("data-trip-id");
  await scroller.evaluate((element) => {
    element.scrollTop = 100000;
  });
  await expect(grid.locator("tr[data-trip-id]").first()).not.toHaveAttribute(
    "data-trip-id",
    initialId ?? "",
  );
  expect(requests.filter((r) => r.path.endsWith("/window"))).toHaveLength(0);
  for (let i = 0; i < 3; i++) {
    const previous = requests.filter((r) => r.path.endsWith("/window")).length;
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => requests.filter((r) => r.path.endsWith("/window")).length)
      .toBe(previous + 1);
    await expect(label).toHaveText(
      i === 2
        ? "5001–20000 loaded · 22,051 matching trips"
        : `1–${(i + 2) * 5000} loaded · 22,051 matching trips`,
    );
    expect(await grid.locator("tr[data-trip-id]").count()).toBeLessThanOrEqual(
      80,
    );
  }
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(label).toHaveText("1–15000 loaded · 22,051 matching trips");
  expect(await grid.locator("tr[data-trip-id]").count()).toBeLessThanOrEqual(
    80,
  );
});

test("worker failure clears busy state and reload creates a working replacement", async ({
  page,
  context,
}) => {
  await fixtures(context);
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(window, "activeGridWorker", {
          value: this,
          configurable: true,
        });
      }
    };
  });
  await page.goto("/trips-preview");
  await expect(
    page.getByRole("status").filter({ hasText: "Complete result" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { activeGridWorker: Worker }
    ).activeGridWorker.dispatchEvent(
      new ErrorEvent("error", { message: "Simulated worker failure" }),
    ),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "worker stopped" }),
  ).toBeVisible();
  await expect(page.locator(".trip-grid-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Reload query" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Complete result" }),
  ).toBeVisible();
  await expect(
    page.locator("#trip-virtual-grid tr[data-trip-id] button").first(),
  ).toBeEnabled();
});

test("narrow grid supports enlarged text and inspection without page overflow", async ({
  page,
  context,
}) => {
  await fixtures(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trips-preview");
  await page.addStyleTag({ content: "html { font-size: 20px; }" });
  await expect(
    page.getByRole("status").filter({ hasText: "Complete result" }),
  ).toBeVisible();
  await expect(
    page.locator("#trip-virtual-grid tr[data-trip-id]").first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/trip-grid-mobile.png",
    fullPage: true,
  });
});

test("visible comment counts are batched, cached and refreshed after posting", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await fixtures(context);
  const batches: string[][] = [];
  let posted = false;
  let postedId = "";
  await context.route("**/api/trip-comment-counts**", (route) => {
    const ids: string[] = JSON.parse(
      new URL(route.request().url()).searchParams.get("tripIds") ?? "[]",
    );
    batches.push(ids);
    return route.fulfill({
      json: Object.fromEntries(
        ids.map((id) => [id, posted && id === postedId ? 1 : 0]),
      ),
    });
  });
  await context.route("**/api/trip-comments**", async (route) => {
    if (route.request().method() === "POST") {
      posted = true;
      postedId = route.request().postDataJSON().trip.trip_id;
      return route.fulfill({
        json: {
          ...route.request().postDataJSON(),
          author: { name: "Avery", email: "avery@example.test" },
          created_at: "2026-11-16T10:00:00Z",
        },
      });
    }
    return route.fulfill({ json: { rows: [], nextCursor: null } });
  });
  await page.goto("/trips-preview");
  const grid = page.locator("#trip-virtual-grid");
  const scroller = grid.locator(".trip-grid-scroll");
  await scroller.evaluate((element) => {
    element.style.height = "1200px";
  });
  await expect
    .poll(() => grid.locator("tr[data-trip-id]").count())
    .toBeGreaterThan(25);
  const first = grid.getByRole("button", { name: /^Inspect trip/ }).first();
  await expect(first).toHaveAttribute("title", "0 comments");
  await expect.poll(() => batches.flat().length).toBeGreaterThan(25);
  expect(batches.every((ids) => ids.length > 0 && ids.length <= 25)).toBe(true);
  await scroller.evaluate((element) => {
    element.scrollTop = 3000;
  });
  await expect.poll(() => batches.length).toBeGreaterThan(2);
  await expect(
    grid.locator("tr[data-trip-id]").last().locator("button"),
  ).toHaveAttribute("title", "0 comments");
  const loaded = batches.flat().length;
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(first).toHaveAttribute("title", "0 comments");
  await page.waitForTimeout(100);
  expect(batches.flat().length).toBe(loaded);
  await first.click();
  const dialog = page.getByRole("dialog", {
    name: "Trip details",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Add a comment", exact: true })
    .fill("Review this fare");
  await dialog
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect.poll(() => posted).toBe(true);
  await page.keyboard.press("Escape");
  await expect(
    grid.locator(`tr[data-trip-id="${postedId}"] button`),
  ).toHaveAttribute("title", "1 comment");
  expect(batches.every((ids) => ids.length <= 25)).toBe(true);
});

for (const server of [false, true]) {
  test(`exports name and contain the ${server ? "visible server subset" : "complete matching result"}`, async ({
    page,
    context,
  }) => {
    await fixtures(context, server);
    await page.goto("/trips-preview?sort=fare");
    const grid = page.locator("#trip-virtual-grid");
    await expect(grid.locator("tr[data-trip-id]").first()).toHaveAttribute(
      "data-trip-id",
      all[1999]?.trip_id ?? "",
    );
    const complete = grid.getByRole("button", {
      name: "Export complete matching result",
      exact: true,
    });
    const button = server
      ? grid.getByRole("button", { name: "Export visible subset", exact: true })
      : complete;
    if (server) await expect(complete).toBeHidden();
    await expect
      .poll(() => grid.locator("tr[data-trip-id]").count())
      .toBeLessThan(40);
    const visibleIds = await grid
      .locator("tr[data-trip-id]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-trip-id")),
      );
    const downloading = page.waitForEvent("download");
    await button.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(
      `taxi-trip-summaries-${server ? "visible-subset" : "complete-result"}.csv`,
    );
    const file = await download.path();
    expect(file).not.toBeNull();
    const csv = await readFile(file ?? "", "utf8");
    const rows = csv.split("\r\n");
    expect(rows[0]).toBe(
      "trip_id,pickup_at,dropoff_at,pickup_zip,dropoff_zip,distance,fare,duration",
    );
    if (server) {
      expect(rows.length - 1).toBeGreaterThan(0);
      expect(rows.length - 1).toBeLessThanOrEqual(80);
      expect(
        rows.slice(1).map((row) => row.split(",")[0]?.replaceAll('"', "")),
      ).toEqual(visibleIds);
    } else expect(rows.length - 1).toBe(all.length);
    expect(rows[1]).toContain(all[1999]?.trip_id);
    expect(rows[1]).toContain('"1999"');
  });
}

test("sort survives browser reload and back navigation", async ({
  page,
  context,
}) => {
  await fixtures(context);
  await page.goto("/trips-preview?sort=fare");
  const select = page.getByRole("combobox", { name: "Sort trips" });
  await expect(select).toHaveValue("fare");
  await select.selectOption("distance");
  await expect(page).toHaveURL(/sort=distance/);
  await page.reload();
  await expect(select).toHaveValue("distance");
  await select.selectOption("fare");
  await expect(page).toHaveURL(/sort=fare/);
  await page.goBack();
  await expect(select).toHaveValue("distance");
});

test("forced reload refreshes cell values for retained trip IDs", async ({
  page,
  context,
}) => {
  const source = tripRows(10);
  const requests = await fixtures(context, false, source);
  await page.goto("/trips-preview?sort=fare");
  const first = page.locator("#trip-virtual-grid tr[data-trip-id]").first();
  await expect(first).toHaveAttribute("data-trip-id", source[9]?.trip_id ?? "");
  await expect(first.locator("td").nth(5)).toHaveText("$9.00");
  const changed = source[9];
  if (!changed) throw new Error("Missing fixture trip");
  source[9] = { ...changed, fare: 1234, distance: 42 };
  await page.getByRole("button", { name: "Reload query" }).click();
  await expect(first.locator("td").nth(5)).toHaveText("$1,234.00");
  await expect(first.locator("td").nth(3)).toHaveText("42.00 mi");
  expect(
    requests.filter((request) => request.path === "/api/trip-datasets"),
  ).toHaveLength(2);
});

test("failed DOM mounting terminates its already-created worker", async ({
  page,
  context,
}) => {
  await fixtures(context);
  await page.addInitScript(() => {
    const audit = { started: 0, terminated: 0 };
    Object.defineProperty(window, "gridWorkerAudit", { value: audit });
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        audit.started++;
      }
      override terminate() {
        audit.terminated++;
        super.terminate();
      }
    };
    const OriginalObserver = window.ResizeObserver;
    window.ResizeObserver = class extends OriginalObserver {
      override observe(target: Element, options?: ResizeObserverOptions) {
        if (target.classList.contains("trip-grid-scroll"))
          throw new Error("Simulated mount failure");
        super.observe(target, options);
      }
    };
  });
  await page.goto("/trips-preview");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Unable to mount the trip grid" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "gridWorkerAudit")),
  ).toEqual({ started: 1, terminated: 1 });
});

test("replacement worker construction failure stays visible and another reload recovers", async ({
  page,
  context,
}) => {
  await fixtures(context);
  await page.addInitScript(() => {
    const Original = window.Worker;
    let attempts = 0;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (++attempts === 2) throw new Error("Simulated constructor failure");
        super(url, options);
        Object.defineProperty(window, "activeGridWorker", {
          value: this,
          configurable: true,
        });
      }
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/trips-preview");
  const status = page.getByRole("status");
  await expect(status.filter({ hasText: "Complete result" })).toBeVisible();
  await page.evaluate(() => {
    const worker: unknown = Reflect.get(window, "activeGridWorker");
    if (!(worker instanceof Worker)) throw new Error("Missing worker");
    worker.dispatchEvent(new ErrorEvent("error"));
  });
  await expect(status.filter({ hasText: "worker stopped" })).toBeVisible();
  await page.getByRole("button", { name: "Reload query" }).click();
  await expect(status.filter({ hasText: "worker stopped" })).toBeVisible();
  await page.getByRole("button", { name: "Reload query" }).click();
  await expect(status.filter({ hasText: "Complete result" })).toBeVisible();
  expect(errors).toEqual([]);
});
