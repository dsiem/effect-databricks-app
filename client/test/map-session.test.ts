import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonMap, type MapResource } from "../src/features/gps/dataset";
import {
  createMapSession,
  type MapQuery,
  type MapSessionEvent,
} from "../src/features/gps/dataset-session";
import { dataKey } from "../src/features/gps/model";
import { gpsFixture } from "./gps-fixture";

const query: MapQuery = {
  query: "zip=10001",
  filters: { zip: "10001" },
  endpoint: "pickup",
  revision: 0,
};
const resource = () => jsonMap(gpsFixture());
const deferred = <A>() => {
  let resolve: ((value: A) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    promise,
    resolve(value: A) {
      assert.ok(resolve);
      resolve(value);
    },
    reject(error: unknown) {
      assert.ok(reject);
      reject(error);
    },
  };
};
const loader = () => {
  const requests: Array<{
    input: MapQuery;
    signal: AbortSignal;
    result: ReturnType<typeof deferred<MapResource>>;
  }> = [];
  return {
    requests,
    load: (input: MapQuery, signal: AbortSignal) => {
      const result = deferred<MapResource>();
      requests.push({ input, signal, result });
      return result.promise;
    },
    at(index: number) {
      const request = requests[index];
      assert.ok(request);
      return request;
    },
  };
};

test("map session deduplicates requests and makes new data available before notifying", async () => {
  const loads = loader();
  const events: MapSessionEvent[] = [];
  const first = resource();
  const next = resource();
  const session = createMapSession({
    load: loads.load,
    notify: (event) => {
      events.push(event);
      if (events.length === 2) assert.equal(session.current(), next);
    },
  });
  const initial = session.replace(query);
  await session.replace({ ...query });
  assert.equal(loads.requests.length, 1);
  loads.at(0).result.resolve(first);
  await initial;
  assert.equal(session.current(), first);
  await session.replace(query);
  assert.equal(loads.requests.length, 1);

  const replacement = session.replace({ ...query, revision: 1 });
  assert.equal(loads.at(0).signal.aborted, true);
  assert.equal(session.current(), first);
  loads.at(1).result.resolve(next);
  await replacement;
  assert.deepEqual(events, [
    {
      _tag: "Loaded",
      key: dataKey(query.query, query.endpoint, 0),
      data: first.summary,
    },
    {
      _tag: "Loaded",
      key: dataKey(query.query, query.endpoint, 1),
      data: next.summary,
    },
  ]);
  session.dispose();
});

test("map session ignores obsolete results even when the loader ignores abort", async () => {
  const loads = loader();
  const events: MapSessionEvent[] = [];
  const session = createMapSession({
    load: loads.load,
    notify: (event) => events.push(event),
  });
  const original = session.replace(query);
  const changed = session.replace({ ...query, endpoint: "dropoff" });
  const retry = session.replace({ ...query, revision: 1 });
  assert.equal(loads.at(0).signal.aborted, true);
  assert.equal(loads.at(1).signal.aborted, true);
  const current = resource();
  loads.at(2).result.resolve(current);
  await retry;
  loads.at(0).result.resolve(resource());
  loads.at(1).result.reject(new Error("obsolete failure"));
  await Promise.all([original, changed]);
  assert.equal(session.current(), current);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.key, dataKey(query.query, query.endpoint, 1));
  session.dispose();
});

test("a failed map replacement keeps the visible dataset until a revision retries", async () => {
  const loads = loader();
  const events: MapSessionEvent[] = [];
  const session = createMapSession({
    load: loads.load,
    notify: (event) => events.push(event),
  });
  const initial = session.replace(query);
  const first = resource();
  loads.at(0).result.resolve(first);
  await initial;
  const input = { ...query, query: "zip=10019", filters: { zip: "10019" } };
  const replacement = session.replace(input);
  const error = new Error("offline");
  loads.at(1).result.reject(error);
  await replacement;
  assert.equal(session.current(), first);
  assert.deepEqual(events[1], {
    _tag: "Failed",
    key: dataKey(input.query, input.endpoint),
    error,
  });
  const retried = session.replace({ ...input, revision: 1 });
  const next = resource();
  loads.at(2).result.resolve(next);
  await retried;
  assert.equal(session.current(), next);
  session.dispose();
});

test("map disposal aborts loading and suppresses late publication", async () => {
  const loads = loader();
  const events: MapSessionEvent[] = [];
  const session = createMapSession({
    load: loads.load,
    notify: (event) => events.push(event),
  });
  const initial = session.replace(query);
  loads.at(0).result.resolve(resource());
  await initial;
  const pending = session.replace({ ...query, revision: 1 });
  session.dispose();
  session.dispose();
  assert.equal(session.current(), undefined);
  assert.equal(loads.at(1).signal.aborted, true);
  loads.at(1).result.resolve(resource());
  await pending;
  assert.equal(events.length, 1);
  await session.replace({ ...query, revision: 2 });
  assert.equal(loads.requests.length, 2);
});

test("a drawing exception reaches the caller without reporting a load failure", async () => {
  const loads = loader();
  const events: MapSessionEvent[] = [];
  const drawError = new Error("WebGL unavailable");
  const session = createMapSession({
    load: loads.load,
    notify: (event) => {
      events.push(event);
      if (events.length === 2) throw drawError;
    },
  });
  const initial = session.replace(query);
  loads.at(0).result.resolve(resource());
  await initial;
  const replacement = session.replace({ ...query, revision: 1 });
  const next = resource();
  loads.at(1).result.resolve(next);
  await assert.rejects(replacement, drawError);
  assert.equal(session.current(), next);
  assert.ok(events.every((event) => event._tag === "Loaded"));
  session.dispose();
});
