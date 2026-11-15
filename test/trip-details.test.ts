import assert from "node:assert/strict";
import { test } from "node:test";
import { tableFromArrays } from "apache-arrow";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { Analytics } from "../src/analytics.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";
import { warehouseFetch } from "./warehouse-fixture.js";

test("warehouse trips decode actual GPS, zero tips and missing endpoints into API details", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const details = {
    source_file: "yellow_tripdata_2016-01.csv.gz",
    vendor_id: 2,
    passenger_count: 1,
    rate_code_id: 1,
    store_and_fwd_flag: "N",
    payment_type: 2,
    pickup_location: { longitude: -73.99, latitude: 40.75 },
    dropoff_location: null,
    tip_amount: 0,
    tolls_amount: 0,
    extra: 0.5,
    mta_tax: 0.5,
    improvement_surcharge: 0.3,
    total_amount: 11.3,
  };
  globalThis.fetch = warehouseFetch(async (statement) =>
    statement.includes("AS total FROM")
      ? tableFromArrays({ total: [1] })
      : tableFromArrays({
          trip_id: ["trip-1"],
          pickup_at: ["2016-01-01 10:00:00"],
          dropoff_at: ["2016-01-01 10:10:00"],
          pickup_zip: ["10001"],
          dropoff_zip: ["Unknown"],
          fare: [10],
          distance: [2],
          duration: [10],
          details: [JSON.stringify(details)],
        }),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const analytics = yield* Analytics;
      return yield* analytics.trips({});
    }).pipe(
      Effect.provide(
        Analytics.layer.pipe(
          Layer.provide(
            Layer.succeed(Workspace, {
              accessToken: Effect.succeed(Redacted.make("test")),
              request: () => Effect.die("Unexpected workspace request"),
            }),
          ),
          Layer.provide(Settings.layer),
        ),
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          DATABRICKS_HOST: "https://workspace.invalid",
          DATABRICKS_WAREHOUSE_ID: "warehouse",
          TRIP_SNAPSHOT_TABLE: "custom.taxi.trips_2016",
        }),
      ),
      Effect.scoped,
    ),
  );
  assert.equal(result.total, 1);
  assert.deepEqual(result.rows[0]?.details, details);
});
