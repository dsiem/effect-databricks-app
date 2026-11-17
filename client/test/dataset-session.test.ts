import assert from "node:assert/strict";
import { test } from "node:test";
import type { Trip } from "../../shared/domain";
import {
  retentionCharge,
  type TripDataset,
  type TripQuery,
  tripQueryKey,
} from "../../shared/trip-dataset";
import {
  createDatasetSession,
  type TripApi,
} from "../src/features/trips/dataset-session";
import type { WorkerResponse } from "../src/features/trips/grid-protocol";

const trip: Trip = {
  trip_id: "00000000-0000-4000-8000-000000000001",
  pickup_at: "2016-01-01 10:00:00.000000",
  dropoff_at: "2016-01-01 10:15:00.000000",
  pickup_zip: "10001",
  dropoff_zip: "10002",
  distance: 2,
  fare: 10,
  duration: 15,
};
const query: TripQuery = { filters: {}, sort: "newest" };
const dataset = (q = query): TripDataset => ({
  scope: "complete",
  schemaVersion: 1,
  query: q,
  queryKey: tripQueryKey(q),
  snapshot: "snapshot-1",
  datasetKey: "dataset-1",
  total: 1,
  loaded: 1,
  budget: { rows: 100, bytes: 100000 },
  retainedBytes: retentionCharge([trip]),
  rows: [trip],
});
const deferred = <A>() => {
  let resolve: (value: A) => void = () => {
    throw new Error("Deferred not initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture(overrides: Partial<TripApi> = {}) {
  const messages: WorkerResponse[] = [];
  const api: TripApi = {
    dataset: async (q) => dataset(q),
    window: async () => {
      throw new Error("Unexpected continuation");
    },
    detail: async () => trip,
    counts: async (ids) => Object.fromEntries(ids.map((id) => [id, 2])),
    ...overrides,
  };
  const session = createDatasetSession({
    api,
    emit: (message) => messages.push(message),
  });
  const load = (key: string, q = query, force = false) =>
    session.receive({ type: "query", key, query: q, force });
  return { session, messages, load };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("obsolete dataset success and failure cannot replace the current result", async (t) => {
  const old = deferred<TripDataset>();
  const signals: AbortSignal[] = [];
  const { session, messages, load } = fixture({
    dataset: (q, signal) => {
      signals.push(signal);
      return signals.length === 1 ? old.promise : Promise.resolve(dataset(q));
    },
  });
  t.after(() => session.dispose());
  const pending = load("old");
  await load("new");
  assert.equal(signals[0]?.aborted, true);
  const before = messages.length;
  old.resolve(dataset());
  await pending;
  assert.equal(messages.length, before);
  assert.equal(
    messages.findLast((message) => message.type === "window")?.key,
    "new",
  );

  const failing = deferred<TripDataset>();
  const second = fixture({
    dataset: (q) =>
      q.sort === "fare" ? failing.promise : Promise.resolve(dataset(q)),
  });
  t.after(() => second.session.dispose());
  const rejected = second.load("failing", { filters: {}, sort: "fare" });
  await second.load("ready");
  const ready = second.messages.length;
  failing.reject(new Error("late failure"));
  await rejected;
  assert.equal(second.messages.length, ready);
  await second.session.receive({ type: "export", key: "ready" });
  assert.ok(
    second.messages.some(
      (message) =>
        message.type === "export" && message.csv.includes(trip.trip_id),
    ),
  );
});

test("complete reuse keeps the original source coverage and force replaces it", async (t) => {
  let requests = 0;
  const { session, messages, load } = fixture({
    dataset: async (q) => {
      requests++;
      return dataset(q);
    },
  });
  t.after(() => session.dispose());
  await load("all");
  await load("narrow", { filters: { zip: "10002" }, sort: "fare" });
  assert.deepEqual(
    messages.findLast((message) => message.type === "window")?.rows,
    [],
  );
  await load("wide");
  assert.equal(requests, 1);
  assert.equal(
    messages.findLast((message) => message.type === "window")?.rows.length,
    1,
  );
  await load("forced", query, true);
  assert.equal(requests, 2);
});

test("rapid inspection and replacement discard obsolete detail completions", async (t) => {
  const first = deferred<Trip>();
  const second = deferred<Trip>();
  const signals: AbortSignal[] = [];
  const { session, messages, load } = fixture({
    detail: (_id, snapshot, signal) => {
      assert.equal(snapshot, "snapshot-1");
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    },
  });
  t.after(() => session.dispose());
  await load("query");
  const a = session.receive({
    type: "inspect",
    key: "query",
    tripId: trip.trip_id,
  });
  const b = session.receive({
    type: "inspect",
    key: "query",
    tripId: trip.trip_id,
  });
  assert.equal(signals[0]?.aborted, true);
  first.resolve(trip);
  await a;
  assert.equal(
    messages.some((message) => message.type === "selected"),
    false,
  );
  await load("next");
  assert.equal(signals[1]?.aborted, true);
  second.resolve(trip);
  await b;
  assert.equal(
    messages.some((message) => message.type === "selected"),
    false,
  );
});

test("count invalidation waits for the single runner then discards its old revision", async (t) => {
  const old = deferred<Readonly<Record<string, number>>>();
  const fresh = deferred<Readonly<Record<string, number>>>();
  let requests = 0;
  const { session, messages, load } = fixture({
    counts: () => (++requests === 1 ? old.promise : fresh.promise),
  });
  t.after(() => session.dispose());
  await load("query");
  await session.receive({ type: "invalidate-counts", key: "query" });
  assert.equal(requests, 1);
  old.resolve({ [trip.trip_id]: 99 });
  await settle();
  assert.equal(requests, 2);
  assert.equal(
    messages.some(
      (message) =>
        message.type === "counts" && message.counts[trip.trip_id] === 99,
    ),
    false,
  );
  fresh.resolve({ [trip.trip_id]: 3 });
  await settle();
  assert.equal(
    messages.findLast((message) => message.type === "counts")?.counts[
      trip.trip_id
    ],
    3,
  );
});

test("query replacement restarts counts after obsolete cleanup without publishing old values", async (t) => {
  const old = deferred<Readonly<Record<string, number>>>();
  let requests = 0;
  const signals: AbortSignal[] = [];
  const { session, messages, load } = fixture({
    counts: (_ids, signal) => {
      signals.push(signal);
      return ++requests === 1
        ? old.promise
        : Promise.resolve({ [trip.trip_id]: 4 });
    },
  });
  t.after(() => session.dispose());
  await load("old");
  await load("new", { filters: {}, sort: "fare" });
  assert.equal(signals[0]?.aborted, true);
  assert.equal(requests, 1);
  const before = messages.length;
  old.resolve({ [trip.trip_id]: 99 });
  await settle();
  assert.equal(requests, 2);
  assert.ok(messages.slice(before).every((message) => message.key === "new"));
  assert.equal(
    messages.findLast((message) => message.type === "counts")?.counts[
      trip.trip_id
    ],
    4,
  );
});

test("disposal aborts pending work, ignores completions and releases retained export access", async () => {
  const detail = deferred<Trip>();
  const counts = deferred<Readonly<Record<string, number>>>();
  const signals: AbortSignal[] = [];
  const { session, messages, load } = fixture({
    counts: (_ids, signal) => {
      signals.push(signal);
      return counts.promise;
    },
    detail: (_id, _snapshot, signal) => {
      signals.push(signal);
      return detail.promise;
    },
  });
  await load("query");
  const inspect = session.receive({
    type: "inspect",
    key: "query",
    tripId: trip.trip_id,
  });
  session.dispose();
  session.dispose();
  assert.ok(signals.every((signal) => signal.aborted));
  const before = messages.length;
  counts.resolve({ [trip.trip_id]: 99 });
  detail.resolve(trip);
  await inspect;
  await settle();
  await session.receive({ type: "export", key: "query" });
  await load("after-dispose");
  session.invalidRequest();
  assert.equal(messages.length, before);
});

test("replacement queries retain the requested viewport size", async (t) => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    ...trip,
    trip_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  }));
  const { session, messages, load } = fixture({
    dataset: async (q) => ({
      ...dataset(q),
      rows,
      total: rows.length,
      loaded: rows.length,
      retainedBytes: retentionCharge(rows),
    }),
  });
  t.after(() => session.dispose());
  await load("first");
  await session.receive({ type: "range", key: "first", start: 0, count: 12 });
  await load("next", { filters: {}, sort: "fare" });
  assert.equal(
    messages.findLast((message) => message.type === "window")?.rows.length,
    12,
  );
});
