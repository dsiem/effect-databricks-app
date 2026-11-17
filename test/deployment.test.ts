import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { gpsFixture } from "../client/test/gps-fixture.js";
import type { SavedView } from "../shared/domain.js";

const run = promisify(execFile);

for (const failure of [
  null,
  "warehouse",
  "trips",
  "details",
  "gps",
  "create",
  "list",
  "genie",
] as const) {
  test(`hosted verification ${failure ? `fails on ${failure} errors despite RUNNING` : "checks SQL, paginated persistence, and Genie"}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "deployed-check-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let saved: SavedView | undefined;
    let created = 0;
    let deleted = 0;
    let followedCursor = false;
    const operation = { conversationId: "conversation", messageId: "message" };
    const cursor = {
      id: "472a6613-2337-4af1-a416-e9b6b61064dd",
      pinned: true,
      updatedAt: "2026-11-13T10:00:00.000001Z",
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      assert.equal(request.headers.authorization, "Bearer test-token");
      const reply = (value: unknown, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === "/health") return reply({ status: "ok" });
      if (url.pathname === "/api/metadata")
        return failure === "warehouse"
          ? reply({ error: { message: "Warehouse unavailable" } }, 503)
          : reply({ trips: 10 });
      if (url.pathname === "/api/overview")
        return reply({ summary: { trips: 10 } });
      if (url.pathname === "/api/trips")
        return failure === "trips"
          ? reply({ error: { message: "Trips unavailable" } }, 503)
          : reply({
              total: 10,
              rows: [
                {
                  details:
                    failure === "details"
                      ? undefined
                      : {
                          source_file: "yellow_tripdata_2016-01.csv.gz",
                          total_amount: 10,
                          pickup_location: {
                            longitude: -73.99,
                            latitude: 40.75,
                          },
                        },
                },
              ],
            });
      if (url.pathname === "/api/trip-map") {
        if (failure === "gps")
          return reply({ error: { message: "GPS unavailable" } }, 503);
        const endpoint =
          url.searchParams.get("endpoint") === "dropoff" ? "dropoff" : "pickup";
        const activity = gpsFixture(endpoint);
        return reply({
          ...activity,
          matchingTrips: 10,
          locatedTrips: 8,
          shownTrips: 8,
          totalCells: 1,
          cells: [{ ...activity.cells[0], trips: 8 }],
        });
      }
      if (url.pathname === "/api/saved-views" && request.method === "PUT") {
        if (failure === "create")
          return reply({ error: { message: "Create failed" } }, 503);
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        saved = {
          ...JSON.parse(Buffer.concat(chunks).toString()),
          version: 1,
        } as SavedView;
        created++;
        return reply(saved);
      }
      if (url.pathname === "/api/saved-views" && request.method === "GET") {
        if (failure === "list")
          return reply({ error: { message: "Listing unavailable" } }, 503);
        if (url.searchParams.has("cursor")) {
          assert.deepEqual(
            JSON.parse(url.searchParams.get("cursor") ?? ""),
            cursor,
          );
          followedCursor = true;
          return reply({ rows: saved ? [saved] : [], nextCursor: null });
        }
        // A newly created unpinned saved view can sit behind existing pinned saved views.
        return reply({ rows: [{ id: cursor.id }], nextCursor: cursor });
      }
      if (
        url.pathname.startsWith("/api/saved-views/") &&
        request.method === "DELETE"
      ) {
        assert.equal(url.pathname, `/api/saved-views/${saved?.id}`);
        assert.equal(url.searchParams.get("version"), String(saved?.version));
        deleted++;
        saved = undefined;
        return reply({ deleted: true });
      }
      if (url.pathname === "/api/genie") return reply(operation);
      if (url.pathname.endsWith("/result"))
        return reply({
          ...operation,
          queries: [{ rows: [[failure === "genie" ? "999" : "10"]] }],
        });
      if (url.pathname === "/api/genie/conversation/messages/message")
        return reply({
          ...operation,
          state: "completed",
          status: "COMPLETED",
        });
      reply({ error: "Unexpected route" }, 404);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const responses = {
      "bundle summary": { resources: { apps: { app: { name: "test-app" } } } },
      "apps get": {
        app_status: { state: "RUNNING" },
        url: `http://127.0.0.1:${address.port}`,
      },
      "auth token": { access_token: "test-token" },
    };
    await writeFile(
      join(directory, "databricks"),
      `#!/usr/bin/env node
const responses = ${JSON.stringify(responses)};
console.log(JSON.stringify(responses[process.argv.slice(2, 4).join(" ")]));
`,
      { mode: 0o700 },
    );
    const verification = run(
      process.execPath,
      [resolve("scripts/check-deployed.mjs"), "dev"],
      {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        timeout: 15_000,
      },
    );
    if (failure) await assert.rejects(verification);
    else assert.match((await verification).stdout, /Deployed app verified/);
    assert.equal(
      created,
      ["warehouse", "trips", "details", "gps", "create"].includes(failure ?? "")
        ? 0
        : 1,
    );
    assert.equal(
      deleted,
      created,
      "verification must clean up its temporary saved view on success and failure",
    );
    assert.equal(followedCursor, !failure || failure === "genie");
  });
}
