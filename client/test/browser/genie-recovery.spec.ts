import { expect, type Page, test } from "@playwright/test";

const operation = { conversationId: "conversation", messageId: "message" };
const messagePath = "/api/genie/conversation/messages/message";
const reply = {
  ...operation,
  text: "Recovered answer",
  queries: [
    {
      sql: "SELECT 21932",
      description: "Trip count",
      columns: ["total_trips"],
      rows: [["21932"]],
      truncated: false,
    },
  ],
};
async function mockStatus(page: Page) {
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
}
async function send(page: Page) {
  await page.getByLabel("Ask a question about taxi data").fill("Count trips");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
}

test("result retry survives navigation and reload, and follow-ups reuse the conversation", async ({
  page,
}) => {
  await mockStatus(page);
  const submissions: unknown[] = [];
  let downloads = 0;
  await page.route("**/api/genie", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: operation });
  });
  await page.route(`**${messagePath}`, (route) =>
    route.fulfill({
      json: { ...operation, state: "completed", status: "COMPLETED" },
    }),
  );
  await page.route(`**${messagePath}/result`, (route) => {
    downloads++;
    return route.fulfill(
      downloads === 1
        ? {
            status: 502,
            json: { error: { message: "Result download failed" } },
          }
        : { json: reply },
    );
  });
  await page.goto("/genie?zip=10001");
  await send(page);
  await expect(
    page.getByRole("button", { name: "Retry result download" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Trip explorer", exact: true }).click();
  await page
    .locator("header")
    .getByRole("button", { name: "Ask Genie", exact: true })
    .click();
  await page.reload();
  await page
    .locator("header")
    .getByRole("button", { name: "Ask Genie", exact: true })
    .click();
  await expect(page.getByText("Count trips", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry result download" }).click();
  await expect(
    page.getByRole("cell", { name: "21932", exact: true }),
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(downloads).toBe(2);
  await page.getByLabel("Ask a question about taxi data").fill("Count again");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.getByRole("table")).toHaveCount(2);
  expect(submissions[1]).toMatchObject({ conversationId: "conversation" });
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page.reload();
  await page
    .locator("header")
    .getByRole("button", { name: "Ask Genie", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Go deeper into this view" }),
  ).toBeVisible();
});

test("pending answers resume after reload without resubmission", async ({
  page,
}) => {
  await mockStatus(page);
  let submissions = 0;
  let complete = false;
  await page.route("**/api/genie", (route) => {
    submissions++;
    return route.fulfill({ json: operation });
  });
  await page.route(`**${messagePath}`, (route) =>
    route.fulfill({
      json: {
        ...operation,
        state: complete ? "completed" : "pending",
        status: complete ? "COMPLETED" : "EXECUTING_QUERY",
      },
    }),
  );
  await page.route(`**${messagePath}/result`, (route) =>
    route.fulfill({ json: reply }),
  );
  await page.goto("/genie");
  await send(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("databricks-effect-app.genie.v1"),
      ),
    )
    .toContain('"state":"waiting"');
  complete = true;
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "21932", exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
});

test("submission responses are saved when navigating away before acceptance", async ({
  page,
}) => {
  await mockStatus(page);
  let submissions = 0;
  let accept: () => void = () => {};
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  await page.route("**/api/genie", async (route) => {
    submissions++;
    await accepted;
    await route.fulfill({ json: operation });
  });
  await page.route(`**${messagePath}`, (route) =>
    route.fulfill({
      json: { ...operation, state: "completed", status: "COMPLETED" },
    }),
  );
  await page.route(`**${messagePath}/result`, (route) =>
    route.fulfill({ json: reply }),
  );
  await page.goto("/genie");
  await send(page);
  await expect.poll(() => submissions).toBe(1);
  await page.getByRole("link", { name: "Trip explorer", exact: true }).click();
  accept();
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("databricks-effect-app.genie.v1"),
      ),
    )
    .toContain('"messageId":"message"');
  await page
    .locator("header")
    .getByRole("button", { name: "Ask Genie", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "21932", exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
});

test("reload during an uncertain submission never silently resubmits", async ({
  page,
}) => {
  await mockStatus(page);
  let submissions = 0;
  await page.route("**/api/genie", (route) => {
    submissions++;
    return route.abort("failed");
  });
  await page.goto("/genie");
  await send(page);
  await expect(page.getByRole("alert")).toContainText("may have been accepted");
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("may have been accepted");
  expect(submissions).toBe(1);
});

for (const { name, status, error } of [
  {
    name: "validation",
    status: 400,
    error: { code: "invalid_request", message: "Check the question fields." },
  },
  {
    name: "permission",
    status: 502,
    error: {
      code: "workspace_request_failed",
      message: "Access denied.",
      upstreamStatus: 403,
    },
  },
  {
    name: "rate limit",
    status: 502,
    error: {
      code: "workspace_request_failed",
      message: "Too many requests.",
      upstreamStatus: 429,
    },
  },
] as const) {
  test(`${name} rejection survives reload and allows an explicit corrected submission`, async ({
    page,
  }) => {
    await mockStatus(page);
    const submissions: unknown[] = [];
    await page.route("**/api/genie", (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill(
        submissions.length === 1
          ? { status, json: { error } }
          : { json: operation },
      );
    });
    await page.route(`**${messagePath}`, (route) =>
      route.fulfill({
        json: { ...operation, state: "completed", status: "COMPLETED" },
      }),
    );
    await page.route(`**${messagePath}/result`, (route) =>
      route.fulfill({ json: reply }),
    );
    await page.goto("/genie");
    await send(page);
    await expect(page.getByRole("alert")).toContainText(error.message);
    await expect(page.getByRole("alert")).toContainText("was rejected");
    await expect(page.getByRole("alert")).not.toContainText(
      "may have been accepted",
    );
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("was rejected");
    expect(submissions).toHaveLength(1);
    await page.getByRole("button", { name: "Edit question" }).click();
    const composer = page.getByLabel("Ask a question about taxi data");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Count trips");
    await composer.fill("Count trips by hour");
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "21932", exact: true }),
    ).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toMatchObject({ content: "Count trips by hour" });
  });
}

for (const { name, status, json } of [
  {
    name: "application timeout",
    status: 504,
    json: {
      error: { code: "genie_timeout", message: "Submission timed out." },
    },
  },
  {
    name: "upstream timeout",
    status: 502,
    json: {
      error: {
        code: "workspace_request_failed",
        message: "Upstream timed out.",
        upstreamStatus: 408,
      },
    },
  },
  {
    name: "upstream server failure",
    status: 502,
    json: {
      error: {
        code: "workspace_request_failed",
        message: "Upstream failed.",
        upstreamStatus: 500,
      },
    },
  },
  {
    name: "workspace connection failure",
    status: 503,
    json: {
      error: { code: "workspace_unavailable", message: "Connection lost." },
    },
  },
  { name: "invalid acceptance response", status: 200, json: {} },
] as const) {
  test(`${name} stays uncertain without replaying the question`, async ({
    page,
  }) => {
    await mockStatus(page);
    let submissions = 0;
    await page.route("**/api/genie", (route) => {
      submissions++;
      return route.fulfill({ status, json });
    });
    await page.goto("/genie");
    await send(page);
    await expect(page.getByRole("alert")).toContainText(
      "may have been accepted",
    );
    await expect(
      page.getByRole("button", { name: "Edit question" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      "may have been accepted",
    );
    expect(submissions).toBe(1);
  });
}
