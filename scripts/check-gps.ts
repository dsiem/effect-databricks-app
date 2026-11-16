import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { Analytics } from "../src/analytics.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";

await Effect.runPromise(
  Effect.gen(function* () {
    const analytics = yield* Analytics;
    const pickup = yield* analytics.tripMap({ endpoint: "pickup" });
    const dropoff = yield* analytics.tripMap({ endpoint: "dropoff" });
    const metadata = yield* analytics.metadata;
    for (const data of [pickup, dropoff]) {
      assert.equal(data.matchingTrips, metadata.trips);
      assert.ok(data.locatedTrips > 20000000);
      assert.equal(data.truncated, false);
      assert.equal(data.shownTrips, data.locatedTrips);
      assert.equal(data.totalCells, data.cells.length);
      assert.equal(
        new Set(data.cells.map((cell) => cell.id)).size,
        data.cells.length,
      );
      assert.ok(
        data.cells.every(
          (cell) =>
            cell.trips > 0 &&
            /^8a[0-9a-f]{13}$/.test(cell.id) &&
            cell.boundary.coordinates[0]?.length === 7,
        ),
      );
    }
    const scoped = yield* analytics.tripMap({
      from: "2016-01-10",
      to: "2016-01-10",
      zip: "10001",
      endpoint: "dropoff",
    });
    const trips = yield* analytics.trips({
      from: "2016-01-10",
      to: "2016-01-10",
      zip: "10001",
    });
    assert.equal(scoped.matchingTrips, trips.total);
    assert.equal(scoped.locatedTrips, scoped.shownTrips);
    const empty = yield* analytics.tripMap({
      from: "2026-01-01",
      endpoint: "pickup",
    });
    assert.deepEqual(
      [
        empty.matchingTrips,
        empty.locatedTrips,
        empty.shownTrips,
        empty.totalCells,
        empty.cells.length,
      ],
      [0, 0, 0, 0, 0],
    );
    yield* Effect.promise(() =>
      mkdir(".databricks/map-prototypes", { recursive: true }),
    );
    yield* Effect.promise(() =>
      writeFile(
        ".databricks/map-prototypes/gps-pickup.json",
        JSON.stringify(pickup),
      ),
    );
    yield* Effect.promise(() =>
      writeFile(
        ".databricks/map-prototypes/gps-dropoff.json",
        JSON.stringify(dropoff),
      ),
    );
    console.log(
      JSON.stringify({
        matchingTrips: metadata.trips,
        pickups: pickup.locatedTrips,
        pickupCells: pickup.cells.length,
        dropoffs: dropoff.locatedTrips,
        dropoffCells: dropoff.cells.length,
        scopedTrips: scoped.matchingTrips,
        empty: true,
      }),
    );
  }).pipe(
    Effect.provide(
      Analytics.layer.pipe(
        Layer.provide(Workspace.layer),
        Layer.provide(Settings.layer),
      ),
    ),
    Effect.scoped,
  ),
);
