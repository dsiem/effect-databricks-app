import assert from "node:assert/strict";
import { Effect, Layer, Schema } from "effect";
import {
  compareTrips,
  TripDataset,
  type TripQuery,
} from "../shared/trip-dataset.js";
import { Analytics } from "../src/analytics.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";

// Bounded, read-only check against the configured seeded taxi snapshot.
// Use EXPLORER_ROW_BUDGET=200 to exercise continuations even for a narrow query.
await Effect.runPromise(
  Effect.gen(function* () {
    const { tripDatasets: api } = yield* Analytics;
    const query: TripQuery = {
      filters: { from: "2016-01-10", to: "2016-01-10", zip: "10001" },
      sort: "fare",
    };
    const first = yield* api.open(query);
    assert.ok(Schema.is(TripDataset)(first));
    assert.ok(first.rows.length > 0);
    assert.ok(
      first.rows.every(
        (row, i) =>
          i === 0 ||
          compareTrips(first.rows[i - 1] ?? row, row, query.sort) <= 0,
      ),
    );
    const selected = first.rows[0];
    assert.ok(selected);
    const details = yield* api.detail({
      tripId: selected.trip_id,
      snapshot: first.snapshot,
    });
    assert.equal(details.trip_id, selected.trip_id);
    assert.equal(details.pickup_at, selected.pickup_at);
    assert.ok(details.details?.source_file);
    if (first.scope === "server-window" && first.next) {
      const next = yield* api.scroll({ query, cursor: first.next });
      assert.equal(next.scope, "server-window");
      if (next.scope !== "server-window" || !next.previous)
        throw new Error("Missing reverse continuation");
      const back = yield* api.scroll({ query, cursor: next.previous });
      assert.deepEqual(back.rows, first.rows);
      assert.equal(
        new Set([...first.rows, ...next.rows].map((row) => row.trip_id)).size,
        first.loaded + next.loaded,
      );
      const last = first.rows.at(-1);
      const nextFirst = next.rows[0];
      assert.ok(
        last && nextFirst && compareTrips(last, nextFirst, query.sort) < 0,
      );
    }
    const empty = yield* api.open({
      filters: { from: "2026-01-01" },
      sort: "newest",
    });
    assert.equal(empty.scope, "complete");
    assert.equal(empty.total, 0);
    console.log(
      JSON.stringify({
        scope: first.scope,
        loaded: first.loaded,
        total: first.total,
        snapshotDetails: true,
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
