import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import {
  type Trip,
  TripCommentInput,
  type TripCommentSearch,
} from "../src/domain.js";
import { migrateNotebook } from "../src/notebook.js";
import { notebookFixture } from "./notebook-fixture.js";

const trip: Trip = {
  trip_id: "7b2c6ab2-6f7d-4f8a-a05f-d07e4eb84a19",
  pickup_at: "2016-01-20 09:42:00",
  dropoff_at: "2016-01-20 09:56:00",
  pickup_zip: "10001",
  dropoff_zip: "10019",
  distance: 3.2,
  fare: 18.5,
  duration: 14,
};
const author = { name: "Analyst", email: "analyst@example.test" };

test("comment boundaries reject empty, oversized and invalid record payloads", () => {
  const input = { id: randomUUID(), trip, body: "Check the fare" };
  assert.deepEqual(Schema.decodeUnknownSync(TripCommentInput)(input), input);
  for (const body of ["", " \n\t ", "x".repeat(4001)])
    assert.throws(() =>
      Schema.decodeUnknownSync(TripCommentInput)({ ...input, body }),
    );
  assert.throws(() =>
    Schema.decodeUnknownSync(TripCommentInput)({
      ...input,
      trip: { ...trip, fare: "18.50" },
    }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(TripCommentInput)({
      ...input,
      trip: { ...trip, pickup_at: "x".repeat(81) },
    }),
  );
});

test("comments persist per trip ID, preserve snapshots and authors, and safely replay a lost response", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { notebook, sql } = yield* notebookFixture;
      const input = {
        id: randomUUID(),
        trip,
        body: "Check this fare against similar trips.",
      };
      assert.deepEqual(yield* notebook.comments({ trip }), {
        rows: [],
        nextCursor: null,
      });
      const saved = yield* notebook.addComment(input, author);
      yield* migrateNotebook(sql);
      assert.deepEqual(yield* notebook.addComment(input, author), saved);
      assert.deepEqual((yield* notebook.comments({ trip })).rows, [saved]);
      assert.equal(saved.body, input.body);
      assert.deepEqual(saved.author, author);
      assert.deepEqual(saved.trip, trip);
      for (const [changed, viewer] of [
        [{ ...input, body: "Different" }, author],
        [{ ...input, trip: { ...trip, trip_id: randomUUID() } }, author],
        [input, { name: "Other", email: null }],
      ] as const) {
        const result = yield* Effect.result(
          notebook.addComment(changed, viewer),
        );
        assert.ok(
          result._tag === "Failure" && result.failure._tag === "InvalidRequest",
        );
      }
      assert.deepEqual(
        yield* notebook.comments({ trip: { ...trip, fare: 25 } }),
        { rows: [saved], nextCursor: null },
      );
      assert.deepEqual(
        yield* notebook.addComment(
          { ...input, trip: { ...trip, fare: 25 } },
          author,
        ),
        saved,
      );
      assert.deepEqual(
        yield* notebook.comments({ trip: { ...trip, trip_id: randomUUID() } }),
        { rows: [], nextCursor: null },
      );
      const anonymous = yield* notebook.addComment(
        { ...input, id: randomUUID() },
        null,
      );
      assert.equal(anonymous.author, null);
      assert.deepEqual(yield* notebook.addComment(anonymous, null), anonymous);
      assert.equal((yield* notebook.comments({ trip })).rows.length, 2);
      assert.equal(
        (yield* notebook.comments({ trip })).rows.find(
          (row) => row.id === saved.id,
        )?.body,
        input.body,
      );
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});

test("older comments remain reachable with microsecond timestamp ties", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { notebook, sql } = yield* notebookFixture;
      for (let index = 0; index < 53; index++)
        yield* notebook.addComment(
          { id: randomUUID(), trip, body: String(index) },
          author,
        );
      yield* sql`UPDATE metrocab.trip_comments SET created_at='2026-11-14T10:00:00Z'::timestamptz + (body::int % 3) * INTERVAL '1 microsecond'`;
      const expected = yield* sql<{
        id: string;
      }>`SELECT id::text AS id FROM metrocab.trip_comments ORDER BY created_at DESC, id DESC`;
      const ids: string[] = [];
      let search: TripCommentSearch = { trip };
      for (let page = 0; ; page++) {
        assert.ok(page < 3, "cursor must advance");
        const result = yield* notebook.comments(search);
        ids.push(...result.rows.map((row) => row.id));
        if (!result.nextCursor) break;
        search = { trip, cursor: result.nextCursor };
      }
      assert.deepEqual(
        ids,
        expected.map((row) => row.id),
      );
      assert.equal(new Set(ids).size, 53);
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});
