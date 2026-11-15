import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const target = process.argv[2] ?? "dev";
const cli = (args) =>
  JSON.parse(
    execFileSync("databricks", [...args, "-o", "json"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
const summary = cli(["bundle", "summary", "-t", target]);
const app = cli(["apps", "get", summary.resources.apps.app.name]);
assert.equal(app.app_status.state, "RUNNING");
const token = cli(["auth", "token"]).access_token;
const request = async (path, method = "GET", body) => {
  const response = await fetch(`${app.url}${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(190000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(
    response.headers.get("content-type")?.includes("application/json"),
    `${path}: expected JSON, got HTTP ${response.status} ${response.headers.get("content-type")}`,
  );
  const result = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(result)}`);
  return result;
};
assert.equal((await request("/health")).status, "ok");
const metadata = await request("/api/metadata");
const overview = await request("/api/overview");
assert.ok(metadata.trips > 0);
assert.equal(overview.summary.trips, metadata.trips);
const trips = await request("/api/trips?page=1");
assert.equal(trips.total, metadata.trips);
assert.ok(trips.rows.length > 0);
assert.ok(
  trips.rows.every(
    (trip) =>
      trip.details?.source_file.startsWith("yellow_tripdata_2016-") &&
      Object.hasOwn(trip.details, "total_amount"),
  ),
  "Hosted trip records must include source lineage and itemized charges",
);
assert.ok(
  trips.rows.some((trip) => trip.details.pickup_location),
  "Hosted trip records must expose recorded GPS endpoints",
);
for (const endpoint of ["pickup", "dropoff"]) {
  const activity = await request(`/api/gps-activity?endpoint=${endpoint}`);
  assert.equal(activity.endpoint, endpoint);
  assert.equal(activity.matchingTrips, metadata.trips);
  assert.ok(
    activity.locatedTrips > 0 && activity.locatedTrips <= metadata.trips,
  );
  assert.equal(
    activity.cells.reduce((total, cell) => total + cell.trips, 0),
    activity.shownTrips,
  );
  assert.ok(activity.cells.every((cell) => cell.boundary.type === "Polygon"));
  if (!activity.truncated)
    assert.equal(activity.shownTrips, activity.locatedTrips);
}
const id = randomUUID();
const created = await request("/api/saved-views", "PUT", {
  id,
  title: "Deployed app verification",
  body: "Temporary app-identity persistence check",
  filters: { zip: "10001" },
  version: null,
});
try {
  let page = await request("/api/saved-views");
  const cursors = new Set();
  while (
    !page.rows.some((savedView) => savedView.id === id) &&
    page.nextCursor
  ) {
    const cursor = JSON.stringify(page.nextCursor);
    assert.ok(!cursors.has(cursor), "Saved-view continuation did not advance");
    cursors.add(cursor);
    page = await request(`/api/saved-views?${new URLSearchParams({ cursor })}`);
  }
  assert.ok(page.rows.some((savedView) => savedView.id === id));
} finally {
  await request(`/api/saved-views/${id}?version=${created.version}`, "DELETE");
}
const operation = await request("/api/genie", "POST", {
  content:
    "How many trips are in the configured trips table? Return a single total_trips column.",
});
assert.ok(operation.conversationId);
assert.ok(operation.messageId);
const messagePath = `/api/genie/${encodeURIComponent(operation.conversationId)}/messages/${encodeURIComponent(operation.messageId)}`;
const deadline = Date.now() + 180000;
let progress = await request(messagePath);
while (progress.state === "pending") {
  assert.ok(
    Date.now() < deadline,
    "Genie answer timed out; retain operation IDs to recover it",
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  progress = await request(messagePath);
}
assert.equal(progress.state, "completed");
const reply = await request(`${messagePath}/result`);
assert.ok(
  reply.queries.some((query) =>
    query.rows.some((row) =>
      row.some((cell) => Number(cell) === metadata.trips),
    ),
  ),
);
console.log(
  `Deployed app verified: SQL, pickup/drop-off GPS maps, Lakebase persistence, and a grounded Genie answer using the app identity. ${app.url}`,
);
