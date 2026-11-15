import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Analytics } from "../src/analytics.js";
import { Genie } from "../src/genie.js";
import { Lakebase } from "../src/lakebase.js";
import { SavedViews } from "../src/saved-views.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";

const services = Layer.mergeAll(
  Analytics.layer,
  Genie.layer,
  SavedViews.layer,
).pipe(
  Layer.provide(Lakebase.layer),
  Layer.provide(Workspace.layer),
  Layer.provideMerge(Settings.layer),
);
await Effect.runPromise(
  Effect.gen(function* () {
    const analytics = yield* Analytics;
    const metadata = yield* analytics.metadata;
    const overview = yield* analytics.overview({});
    assert.ok(metadata.trips > 0);
    assert.equal(overview.summary.trips, metadata.trips);
    assert.equal(
      overview.daily.reduce((sum, day) => sum + day.trips, 0),
      metadata.trips,
    );
    assert.equal(
      overview.hourly.reduce((sum, hour) => sum + hour.trips, 0),
      metadata.trips,
    );
    assert.equal(
      overview.zones.reduce((sum, zone) => sum + zone.trips, 0),
      metadata.trips,
    );
    const zip = overview.zones[0]?.zip;
    assert.ok(zip);
    const search = yield* analytics.trips({ zip, sort: "fare", page: 1 });
    assert.ok(search.rows.length > 0);
    assert.ok(search.rows.every((trip) => trip.pickup_zip === zip));
    assert.ok(
      search.rows.every(
        (trip, index) =>
          index === 0 ||
          trip.fare <= (search.rows[index - 1]?.fare ?? Infinity),
      ),
    );
    const settings = yield* Settings;
    if (settings.pgHost || settings.lakebaseEndpoint) {
      const savedViews = yield* SavedViews;
      const allSavedViews = Effect.gen(function* () {
        const rows = [];
        let page = yield* savedViews.list({});
        rows.push(...page.rows);
        while (page.nextCursor) {
          page = yield* savedViews.list({ cursor: page.nextCursor });
          rows.push(...page.rows);
        }
        return rows;
      });
      const id = randomUUID();
      yield* Effect.acquireUseRelease(
        savedViews.save({
          id,
          title: "Live verification",
          body: "Temporary integration check",
          filters: { zip },
          version: null,
        }),
        (created) =>
          Effect.gen(function* () {
            assert.ok(
              (yield* allSavedViews).some((savedView) => savedView.id === id),
            );
            const updated = yield* savedViews.save({
              id,
              title: "Updated verification",
              body: "Round trip verified",
              filters: { zip },
              version: created.version,
            });
            const pinned = yield* savedViews.pin(id, {
              version: updated.version,
              pinned: true,
            });
            assert.equal(pinned.pinned, true);
            assert.equal(updated.filters.zip, zip);
          }),
        () =>
          allSavedViews.pipe(
            Effect.flatMap((rows) => {
              const current = rows.find((savedView) => savedView.id === id);
              return current
                ? savedViews.remove(id, current.version)
                : Effect.void;
            }),
            Effect.orDie,
          ),
      );
      assert.ok(
        !(yield* allSavedViews).some((savedView) => savedView.id === id),
      );
      console.log(
        "Lakebase create, read, update, delete and filter persistence passed",
      );
    }
    if (settings.genieSpaceId) {
      const genie = yield* Genie;
      const answer = (input: Parameters<typeof genie.submit>[0]) =>
        Effect.gen(function* () {
          const operation = yield* genie.submit(input);
          let progress = yield* genie.poll(operation);
          while (progress.state === "pending") {
            yield* Effect.sleep("1 second");
            progress = yield* genie.poll(operation);
          }
          assert.equal(progress.state, "completed");
          return yield* genie.result(operation);
        }).pipe(Effect.timeout("3 minutes"));
      const reply = yield* answer({
        content:
          "How many trips are in samples.nyctaxi.trips? Return a single total_trips column.",
      });
      assert.ok(reply.conversationId);
      assert.ok(reply.queries.length);
      assert.ok(
        reply.queries.some((query) =>
          query.rows.some((row) =>
            row.some((cell) => Number(cell) === metadata.trips),
          ),
        ),
      );
      const followup = yield* answer({
        content: "Now show the top 3 pickup ZIP codes by trip count.",
        conversationId: reply.conversationId,
      });
      assert.equal(followup.conversationId, reply.conversationId);
      assert.ok(followup.queries.length);
      console.log(
        "Genie grounded SQL result and follow-up conversation passed",
      );
    }
    console.log(
      `SQL verified: ${metadata.trips} trips, ${metadata.from} to ${metadata.to}; daily, hourly and ZIP counts reconcile`,
    );
  }).pipe(Effect.provide(services), Effect.scoped),
);
