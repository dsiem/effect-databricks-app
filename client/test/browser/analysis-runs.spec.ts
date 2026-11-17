import { expect, test } from "@playwright/test";

test("analysis retries safely and a run link resumes monitoring and reuses inputs", async ({
  page,
}) => {
  const input = {
    baselineWeek: "2016-01-04",
    comparisonWeek: "2016-01-18",
    minimumTrips: 75,
  };
  const submissions: unknown[] = [];
  const startedAt = Date.now() - 15_000;
  let state: "running" | "succeeded" = "running";
  let reportReads = 0;
  const summary = () => ({
    id: 123,
    state,
    startedAt,
    endedAt: state === "succeeded" ? startedAt + 15_000 : null,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/api/metadata", (route) =>
    route.fulfill({
      json: { from: "2016-01-01", to: "2016-02-29", trips: 10_000 },
    }),
  );
  await page.route("**/api/analysis-runs", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: submissions.length > 1 ? [summary()] : [] });
    }
    submissions.push(route.request().postDataJSON());
    return submissions.length === 1
      ? route.fulfill({
          status: 504,
          json: {
            error: {
              code: "workspace_timeout",
              message: "Databricks request timed out.",
            },
          },
        })
      : route.fulfill({ status: 202, json: { id: 123 } });
  });
  await page.route("**/api/analysis-runs/123", (route) =>
    route.fulfill({ json: { ...summary(), input, reason: null } }),
  );
  await page.route("**/api/analysis-runs/123/result", (route) => {
    reportReads++;
    return route.fulfill({
      json: {
        input,
        rows: [
          {
            pickupZip: "10001",
            dropoffZip: "10002",
            timeBand: "morning",
            baselineCount: 110,
            comparisonCount: 120,
            baselineP90Minutes: 11.5,
            comparisonP90Minutes: 15,
          },
        ],
      },
    });
  });

  await page.goto("/analysis");
  await expect(
    page.getByRole("heading", { name: "Analysis runs" }),
  ).toBeVisible();
  const baseline = page.getByLabel("Baseline week starts");
  const comparison = page.getByLabel("Comparison week starts");
  const minimum = page.getByLabel("Minimum trips per week");
  await expect(baseline).toHaveAttribute("type", "text");
  await expect(comparison).toHaveAttribute("type", "text");
  const [baselineBox, comparisonBox, minimumBox] = await Promise.all(
    [baseline, comparison, minimum].map((input) => input.boundingBox()),
  );
  if (!baselineBox || !comparisonBox || !minimumBox)
    throw new Error("Cannot measure analysis inputs");
  expect(baselineBox.height).toBeCloseTo(comparisonBox.height, 0);
  expect(baselineBox.height).toBeCloseTo(minimumBox.height, 0);
  expect(comparisonBox.x).toBeGreaterThan(baselineBox.x + baselineBox.width);

  await page
    .getByRole("button", { name: "Choose comparison week start" })
    .click();
  const calendar = page.getByRole("dialog", {
    name: "Choose comparison week start",
  });
  await calendar.getByRole("button", { name: /January 18, 2016/ }).click();
  await expect(comparison).toHaveValue(input.comparisonWeek);
  await expect(calendar).toBeHidden();
  await minimum.fill(String(input.minimumTrips));
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.getByText("Databricks request timed out.")).toBeVisible();
  await page.getByRole("button", { name: "Retry submission" }).click();
  await expect(page).toHaveURL(/\/analysis\?run=123$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Running" }),
  ).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[1]).toMatchObject({ input });
  expect(reportReads).toBe(0);

  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "Running" }),
  ).toBeVisible();
  state = "succeeded";
  await expect(page.getByRole("cell", { name: "+3.5 min" })).toBeVisible({
    timeout: 10_000,
  });
  expect(
    await page.getByRole("table").evaluate((table) => {
      const container = table.parentElement;
      return container && container.scrollWidth === container.clientWidth;
    }),
  ).toBe(true);
  await expect(page.getByRole("link", { name: /Run #123/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(submissions).toHaveLength(2);
  expect(reportReads).toBe(1);

  await page
    .getByRole("button", { name: "Run again with these inputs" })
    .click();
  await expect(page.getByLabel("Comparison week starts")).toHaveValue(
    input.comparisonWeek,
  );
  await expect(page.getByLabel("Minimum trips per week")).toHaveValue(
    String(input.minimumTrips),
  );
  expect(submissions).toHaveLength(2);
});
