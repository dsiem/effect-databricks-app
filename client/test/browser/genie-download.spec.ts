import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("downloads the full Chat CSV on demand without navigating away", async ({
  page,
  context,
}) => {
  const operation = { conversationId: "conv", messageId: "msg" };
  const path = "/api/genie/conv/messages/msg";
  const csv = "trips\r\n1\r\n2\r\n";
  const filePath = `${path}/attachments/query/csv`;
  await page.route("**/api/genie", (route) =>
    route.fulfill({ json: operation }),
  );
  await page.route(`**${path}`, (route) =>
    route.fulfill({
      json: { ...operation, state: "completed", status: "COMPLETED" },
    }),
  );
  await page.route(`**${path}/result`, (route) =>
    route.fulfill({
      json: {
        ...operation,
        text: "Query ready",
        queries: [
          {
            attachmentId: "query",
            sql: "SELECT 1",
            description: "Trips",
            columns: ["trips"],
            rows: [["1"]],
            truncated: true,
          },
        ],
      },
    }),
  );
  let downloads = 0;
  await context.route(`**${filePath}`, (route) => {
    expect(route.request().method()).toBe("POST");
    downloads++;
    return route.fulfill({
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="genie-results.csv"',
      },
      body: csv,
    });
  });

  await page.goto("/genie?zip=10001");
  await page
    .getByLabel("Ask a question about taxi data")
    .fill("How many trips?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Query ready")).toBeVisible();
  expect(downloads).toBe(0);

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full CSV" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("genie-results.csv");
  expect(await readFile(await download.path(), "utf8")).toBe(csv);
  expect(downloads).toBe(1);
  await expect(page).toHaveURL(/\/genie\?zip=10001$/);
});
