import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { tableFromArrays } from "apache-arrow";
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect";
import {
  compareTrips,
  matchesTrip,
  TripDataset,
  type TripQuery,
} from "../shared/trip-dataset.js";
import { Analytics } from "../src/analytics.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";
import { warehouseFetch } from "./warehouse-fixture.js";

// Execute production ordering/predicates/cursors in SQL, with dialect spelling
// translated for embedded Postgres. This is independent of the worker comparator.
test("complete and cursor results agree with local queries, ties and calendar boundaries", async (t) => {
  const db = await PGlite.create();
  const original = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = original;
    await db.close();
  });
  await db.exec(
    `CREATE TABLE trips (trip_id text, tpep_pickup_datetime timestamp, tpep_dropoff_datetime timestamp, pickup_zip text, dropoff_zip text, trip_distance double precision, fare_amount double precision)`,
  );
  await db.exec(`INSERT INTO trips SELECT '00000000-0000-4000-8000-' || lpad(i::text,12,'0'),
    timestamp '2016-01-31 23:59:59.999999' + (i % 3) * interval '0.000001 seconds',
    timestamp '2016-02-01 00:10:00', CASE WHEN i % 2 = 0 THEN '10001' END,
    NULL, (i % 7)::double precision, (i % 5)::double precision FROM generate_series(1,11) i`);
  let truncated = false;
  globalThis.fetch = warehouseFetch(async (statement, _signal, parameters) => {
    if (statement.startsWith("DESCRIBE HISTORY"))
      return tableFromArrays({ version: [7n] });
    assert.match(statement, /VERSION AS OF 7/);
    let query = statement
      .replace(/`custom`\.`taxi`\.`trips` VERSION AS OF 7/g, "trips")
      .replace(/COLLATE UTF8_BINARY/g, 'COLLATE "C"')
      .replace(/ AS STRING/g, " AS TEXT")
      .replace(/::DOUBLE/g, "::double precision")
      .replace(/ AS DOUBLE/g, " AS double precision")
      .replace(
        /date_format\((\w+), 'yyyy-MM-dd HH:mm:ss.SSSSSS'\)/g,
        "to_char($1, 'YYYY-MM-DD HH24:MI:SS.US')",
      )
      .replace(
        /timestampdiff\(SECOND, tpep_pickup_datetime, tpep_dropoff_datetime\)/g,
        "EXTRACT(EPOCH FROM (tpep_dropoff_datetime - tpep_pickup_datetime))",
      )
      .replace(/:p(\d+)/g, (_match, n: string) => `$${n}`);
    if (truncated && query.includes("SELECT * FROM summaries"))
      query = query.replace(/LIMIT \d+/, "LIMIT 1");
    const result = await db.query<Record<string, unknown>>(
      query,
      parameters.map((p) => p.value),
    );
    const columns = Object.fromEntries(
      result.fields.map((field) => [
        field.name,
        result.rows.map((row) => row[field.name]),
      ]),
    );
    return tableFromArrays(columns);
  });
  const layer = Analytics.layer.pipe(
    Layer.provide(
      Layer.succeed(Workspace, {
        authMode: "token",
        accessToken: Effect.succeed(Redacted.make("test")),
        request: () => Effect.die("unused"),
      }),
    ),
    Layer.provide(Settings.layer),
  );
  await t.test(
    "complete results agree with local filtering and sorting at date boundaries",
    async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const { tripDatasets: api } = yield* Analytics;
          const base: TripQuery = { filters: {}, sort: "newest" };
          const complete = yield* api.open(base);
          assert.equal(complete.scope, "complete");
          assert.equal(complete.rows.length, 11);
          assert.ok(Schema.is(TripDataset)(complete));
          for (const sort of ["newest", "fare", "distance"] as const) {
            for (const filters of [
              {},
              { to: "2016-01-31" },
              { from: "2016-02-01", zip: "10001" },
              { from: "2017-01-01" },
            ]) {
              const query = { filters, sort };
              const server = yield* api.open(query);
              assert.deepEqual(
                server.rows.map((row) => row.trip_id),
                complete.rows
                  .filter((row) => matchesTrip(row, filters))
                  .sort((a, b) => compareTrips(a, b, sort))
                  .map((row) => row.trip_id),
              );
            }
          }
          truncated = true;
          assert.equal((yield* Effect.exit(api.open(base)))._tag, "Failure");
          truncated = false;
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnvRecord({
              DATABRICKS_HOST: "https://workspace.invalid",
              DATABRICKS_WAREHOUSE_ID: "warehouse",
              TRIP_SNAPSHOT_TABLE: "custom.taxi.trips",
              EXPLORER_ROW_BUDGET: "20",
            }),
          ),
          Effect.scoped,
        ),
      );
    },
  );
  await t.test(
    "row budgets produce reversible cursors and reject changed or tampered queries",
    async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const { tripDatasets: api } = yield* Analytics;
          const query: TripQuery = { filters: {}, sort: "fare" };
          const first = yield* api.open(query);
          assert.equal(first.scope, "server-window");
          if (first.scope !== "server-window" || !first.next)
            throw new Error("missing cursor");
          assert.equal(first.rows.length, 4);
          assert.ok(Schema.is(TripDataset)(first));
          const second = yield* api.scroll({ query, cursor: first.next });
          if (
            second.scope !== "server-window" ||
            !second.next ||
            !second.previous
          )
            throw new Error("missing cursors");
          const third = yield* api.scroll({ query, cursor: second.next });
          assert.equal(third.rows.length, 3);
          assert.deepEqual(
            [...first.rows, ...second.rows, ...third.rows].map((row) =>
              Number(row.trip_id.slice(-12)),
            ),
            [4, 9, 3, 8, 2, 7, 1, 6, 11, 5, 10],
          );
          assert.equal(third.scope === "server-window" && third.next, null);
          const back = yield* api.scroll({ query, cursor: second.previous });
          assert.deepEqual(back.rows, first.rows);
          assert.equal(
            (yield* Effect.exit(
              api.scroll({
                query: { ...query, sort: "distance" },
                cursor: first.next,
              }),
            ))._tag,
            "Failure",
          );
          assert.equal(
            (yield* Effect.exit(
              api.scroll({ query, cursor: `${first.next}x` }),
            ))._tag,
            "Failure",
          );
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnvRecord({
              DATABRICKS_HOST: "https://workspace.invalid",
              DATABRICKS_WAREHOUSE_ID: "warehouse",
              TRIP_SNAPSHOT_TABLE: "custom.taxi.trips",
              EXPLORER_ROW_BUDGET: "4",
            }),
          ),
          Effect.scoped,
        ),
      );
    },
  );
  await t.test(
    "byte budgets bound the first and subsequent windows",
    async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const { tripDatasets: api } = yield* Analytics;
          const query: TripQuery = { filters: {}, sort: "newest" };
          const first = yield* api.open(query);
          assert.equal(first.scope, "server-window");
          assert.equal(first.loaded, 4);
          assert.ok(first.retainedBytes <= 8192);
          if (first.scope !== "server-window" || !first.next)
            throw new Error("missing continuation");
          const next = yield* api.scroll({ query, cursor: first.next });
          assert.equal(next.scope === "server-window" && next.start, 4);
          assert.ok(next.retainedBytes <= 8192);
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnvRecord({
              DATABRICKS_HOST: "https://workspace.invalid",
              DATABRICKS_WAREHOUSE_ID: "warehouse",
              TRIP_SNAPSHOT_TABLE: "custom.taxi.trips",
              EXPLORER_ROW_BUDGET: "20",
              EXPLORER_BYTE_BUDGET: "8192",
            }),
          ),
          Effect.scoped,
        ),
      );
    },
  );
});

test("a prefix cannot claim completeness or exceed its declared budget", () => {
  const base = {
    schemaVersion: 1,
    scope: "complete",
    query: { filters: {}, sort: "newest" },
    queryKey: "q",
    snapshot: "s",
    datasetKey: "d",
    total: 1,
    loaded: 0,
    rows: [],
    budget: { rows: 1, bytes: 1024 },
    retainedBytes: 8,
  };
  assert.equal(Schema.is(TripDataset)(base), false);
  assert.equal(
    Schema.is(TripDataset)({ ...base, total: 0, retainedBytes: 1025 }),
    false,
  );
  assert.equal(Schema.is(TripDataset)({ ...base, total: 0 }), true);
});
