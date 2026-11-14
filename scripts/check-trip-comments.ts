import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import { Analytics } from "../src/analytics.js";
import { makeDatabase } from "../src/notebook.js";
import { Settings } from "../src/settings.js";
import { makeTripComments } from "../src/trip-comments.js";
import { Workspace } from "../src/workspace.js";

// Development integration check: writes only UUID-scoped temporary comments and
// removes them even if an assertion fails. Run with the migration/deployer role.
const services = Analytics.layer.pipe(
  Layer.provideMerge(Workspace.layer),
  Layer.provideMerge(Settings.layer),
);
await Effect.runPromise(
  Effect.gen(function* () {
    const analytics = yield* Analytics;
    const trip = (yield* analytics.trips({ page: 1 })).rows[0];
    assert.ok(trip, "The warehouse must return a real trip");
    const sql = yield* makeDatabase;
    const { comments, addComment } = makeTripComments(
      sql,
      "Live comment verification failed",
    );
    const id = randomUUID();
    const unknownId = randomUUID();
    yield* Effect.gen(function* () {
      const input = {
        id,
        trip,
        body: "Temporary trip-comment integration check",
      };
      const author = { name: "Live verification", email: null };
      const saved = yield* addComment(input, author);
      assert.deepEqual(yield* addComment(input, author), saved);
      assert.deepEqual(
        (yield* comments({ trip })).rows.find((row) => row.id === id),
        saved,
      );
      assert.deepEqual(saved.trip, trip);
      assert.deepEqual(saved.author, author);
      assert.deepEqual(
        (yield* comments({ trip: { ...trip, fare: trip.fare + 1 } })).rows.find(
          (row) => row.id === id,
        ),
        saved,
      );
      const unknown = yield* addComment({ ...input, id: unknownId }, null);
      assert.equal(unknown.author, null);
      assert.deepEqual(yield* addComment(unknown, null), unknown);
      assert.ok(
        !(yield* comments({
          trip: { ...trip, trip_id: randomUUID() },
        })).rows.some((row) => row.id === id),
      );
    }).pipe(
      Effect.ensuring(
        sql`DELETE FROM metrocab.trip_comments WHERE id=${id}::uuid OR id=${unknownId}::uuid`.pipe(
          Effect.orDie,
        ),
      ),
    );
    const remaining = yield* sql<{
      id: string;
    }>`SELECT id FROM metrocab.trip_comments WHERE id=${id}::uuid OR id=${unknownId}::uuid`;
    assert.equal(remaining.length, 0, "Temporary comments must be removed");
    console.log(
      "Live warehouse snapshot, Lakebase comment persistence, attribution, retry, isolation, and cleanup passed",
    );
  }).pipe(
    Effect.provide(services),
    Effect.provide(Reactivity.layer),
    Effect.scoped,
  ),
);
