import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import {
  makeViews,
  searchViews,
  targetTitle,
} from "../design/saved-views/fixtures.mjs";

// npm's current app server can be used, but all API calls are intercepted.
// Without one, start the current client source ourselves; no backend is needed.
const output = process.env.SAVED_VIEW_STUDY_OUTPUT || "output/saved-view-study";
mkdirSync(output, { recursive: true });
const servers = [];
async function ensureServer(url, configFile, port) {
  try {
    const response = await fetch(url);
    if (response.ok) return;
  } catch {
    /* Start an isolated Vite server below. */
  }
  const server = await createServer({
    configFile,
    cacheDir: fileURLToPath(
      new URL(
        `../node_modules/.vite-saved-view-check-${port}`,
        import.meta.url,
      ),
    ),
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
  });
  await server.listen();
  servers.push(server);
}
await ensureServer(
  "http://127.0.0.1:5188",
  "design/saved-views/vite.config.mjs",
  5188,
);
const appUrl = process.env.SAVED_VIEW_APP_URL || "http://127.0.0.1:5190";
await ensureServer(appUrl, "vite.config.ts", Number(new URL(appUrl).port));
const browser = await chromium.launch();
const evidence = {
  baselineMode:
    "Browse-all pagination; shortcut requests are excluded. The app now also offers global search.",
  baseline: [],
  prototypes: [],
  checks: [],
  limitations:
    "Generated data, local corpus search. Action counts exclude typing, scrolling and reading; no human speed or database latency is measured.",
};
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  page.on("pageerror", (error) => errors.push(error.message));

  // Exercise the actual current Foldkit picker, not a reconstruction.
  for (const count of [24, 250, 1000]) {
    const rows = makeViews(count);
    let requests = 0;
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/saved-views") {
        assert.equal(route.request().method(), "GET");
        requests++;
        const cursor = url.searchParams.get("cursor");
        const start = cursor
          ? rows.findIndex((row) => row.id === JSON.parse(cursor).id) + 1
          : 0;
        const batch = rows.slice(start, start + 24);
        const last = batch.at(-1);
        return route.fulfill({
          json: {
            rows: batch,
            nextCursor:
              start + batch.length < count
                ? {
                    id: last.id,
                    pinned: last.pinned,
                    updatedAt: last.updated_at.replace("Z", "000Z"),
                  }
                : null,
          },
        });
      }
      // Prevent all fixture browser requests from reaching real services.
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "lakebase_unavailable",
            message: "Design study: analytics requests are mocked.",
          },
        },
      });
    });
    await page.goto(`${appUrl}/trips`);
    await page
      .getByRole("button", { name: "Saved views", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Saved views",
      exact: true,
    });
    await expect(
      picker.getByRole("button", { name: /^Open saved view for/ }).first(),
    ).toBeVisible();
    requests = 0;
    await picker
      .getByRole("button", { name: "Browse all views", exact: true })
      .click();
    await expect(
      picker.getByRole("button", { name: /^Open saved view for/ }),
    ).toHaveCount(24);
    if (count === 1000)
      await page.screenshot({ path: `${output}/baseline-first-page.png` });
    let moreClicks = 0;
    while (
      await picker
        .getByRole("button", { name: "Load more views", exact: true })
        .count()
    ) {
      await picker
        .getByRole("button", { name: "Load more views", exact: true })
        .click();
      moreClicks++;
      await expect(
        picker.getByRole("button", { name: /^Open saved view for/ }),
      ).toHaveCount(Math.min((moreClicks + 1) * 24, count));
    }
    await picker
      .getByRole("button", {
        name: `Open saved view for ${targetTitle}`,
        exact: true,
      })
      .click();
    await expect(picker).not.toBeVisible();
    await expect(page).toHaveURL(/zip=11430/);
    await expect(page).toHaveURL(/from=2016-02-01/);
    await expect(page).toHaveURL(/to=2016-02-29/);
    assert.equal(moreClicks, Math.ceil(count / 24) - 1);
    assert.equal(requests, Math.ceil(count / 24));
    evidence.baseline.push({
      views: count,
      requests,
      loadMoreClicks: moreClicks,
      openBrowseAndSelectClicks: moreClicks + 3,
    });
    await page.unrouteAll({ behavior: "wait" });
  }

  for (const count of [24, 250, 1000, 10000]) {
    await page.goto("http://127.0.0.1:5188");
    await page.locator("#volume").selectOption(String(count));
    for (const id of ["quick", "command", "library"]) {
      const root = page.locator(`#${id}`);
      const input = root.getByRole(id === "command" ? "combobox" : "searchbox");
      // No-query suggestions and browse results are bounded even at 10k.
      assert.ok((await root.locator(".view-row").count()) <= 24);
      for (const query of [
        "winter exceptions",
        "flight delays",
        "11430 winter",
      ]) {
        await input.fill(query);
        await expect(root.locator(".view-row")).toHaveCount(1);
        await expect(root.locator(".view-row")).toContainText(targetTitle);
      }
      await input.fill("no-such-view-zzzz");
      await expect(
        root.getByText("No matching views", { exact: true }),
      ).toBeVisible();
      await root
        .getByRole("button", { name: "Clear search and filters" })
        .click();
      await expect(input).toBeFocused();
      await input.fill("winter exceptions");
      if (id === "command") await input.press("Enter");
      else {
        await root.locator(".view-row").click();
        if (id === "library") {
          await expect(root.locator(".applied strong")).toHaveText("All trips");
          await root.getByRole("button", { name: "Apply this view" }).click();
        }
      }
      await expect(root.locator(".applied")).toHaveAttribute(
        "data-view-id",
        makeViews(count).at(-1).id,
      );
      await expect(root.locator(".trigger")).toBeFocused();
      await expect(root.locator(".picker")).toBeHidden();
      await root.locator(".trigger").click();
      await expect(input).toBeFocused();
      if (id !== "library")
        await expect(root.locator(".view-row").last()).not.toContainText(
          "no-such",
        );
      if (id !== "library")
        await expect(
          root.locator(`.view-row[data-id="${makeViews(count).at(-1).id}"]`),
        ).toBeVisible();
      await input.press("Escape");
      await expect(root.locator(".trigger")).toBeFocused();
      evidence.prototypes.push({
        views: count,
        direction: id,
        foundByTitleFindingAndZip: true,
        appliedCorrectId: true,
        escapeAndFocusReturn: true,
        enterToApply: id === "command",
      });
    }
  }

  // Similar names must not cause the wrong filters to be applied.
  await page.goto("http://127.0.0.1:5188");
  const command = page.locator("#command");
  await command.getByRole("combobox").fill("Midtown fare review");
  const expected = searchViews(makeViews(1000), "Midtown fare review");
  await command.getByRole("combobox").press("ArrowDown");
  await expect(command.locator(".preview")).toContainText(expected[1].body);
  await command.getByRole("combobox").press("Enter");
  await expect(command.locator(".applied")).toHaveAttribute(
    "data-view-id",
    expected[1].id,
  );
  const library = page.locator("#library");
  await library.getByRole("searchbox").fill("Midtown fare review");
  await library
    .locator(`.view-row[data-id="${makeViews(1000)[4].id}"]`)
    .click();
  await expect(library.locator(".preview")).toContainText("January 8–14");
  await expect(library.locator(".applied strong")).toHaveText("All trips");
  await library.getByRole("button", { name: "Apply this view" }).click();
  await expect(library.locator(".applied")).toHaveAttribute(
    "data-view-id",
    makeViews(1000)[4].id,
  );
  evidence.checks.push(
    "Duplicate-name keyboard selection and library preview apply the exact record and filters.",
  );

  await page.goto("http://127.0.0.1:5188");
  await library.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(library.locator(".view-row")).toHaveCount(3);
  await library.getByRole("button", { name: "All views", exact: true }).click();
  await library.locator(".zip").selectOption("11430");
  assert.ok(
    (await library.locator(".view-row").allTextContents()).every((text) =>
      text.includes("11430"),
    ),
  );
  await library.locator(".zip").selectOption("");
  await library.locator(".order").selectOption("name");
  await expect(library.locator(".view-row").first()).toContainText(
    searchViews(makeViews(1000), "", "all", "", "name")[0].title,
  );
  await library.getByRole("searchbox").fill("review");
  await expect(library.locator(".view-row")).toHaveCount(24);
  await library.getByRole("button", { name: "Show more matches" }).click();
  await expect(library.locator(".view-row")).toHaveCount(48);
  evidence.checks.push(
    "Library pin and ZIP filters, name sort, and matching-result pagination.",
  );

  await page.goto("http://127.0.0.1:5188");
  await page.screenshot({
    path: `${output}/comparison-desktop.png`,
    fullPage: true,
  });
  for (const id of ["quick", "command", "library"]) {
    const root = page.locator(`#${id}`);
    await root
      .locator("input")
      .fill(id === "quick" ? "flight delays" : "Midtown fare review");
  }
  await page.screenshot({
    path: `${output}/comparison-search.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  for (const id of ["quick", "command", "library"]) {
    await page.locator("#layout").selectOption(id);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const root = page.locator(`#${id}`);
    await root.locator("input").fill("flight delays");
    await root.locator(".view-row").click();
    if (id === "library")
      await root.getByRole("button", { name: "Apply this view" }).click();
    await expect(root.locator(".applied strong")).toHaveText(targetTitle);
    await root.locator(".trigger").click();
    await root.locator("input").fill("flight delays");
    await page.screenshot({
      path: `${output}/${id}-mobile.png`,
      fullPage: true,
    });
  }
  evidence.checks.push(
    "All three select the correct view at 360px without horizontal page overflow.",
  );
  assert.deepEqual(errors, []);
  evidence.checks.push("No browser JavaScript errors.");
  writeFileSync(
    `${output}/verification.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `Verified current picker at 24/250/1,000 views, all three prototypes at 24/250/1,000/10,000 views, keyboard selection, duplicate names, and 360px layouts. Evidence: ${output}/verification.json`,
  );
} finally {
  await browser.close();
  await Promise.all(servers.map((server) => server.close()));
}
