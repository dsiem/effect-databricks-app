import { Effect, Schema, type Scope } from "effect";
import {
  containsQuery,
  retentionCharge,
  type TripDataset,
  type TripQuery,
  tripQueryKey,
} from "../../../../shared/trip-dataset";
import { ApiClient, request } from "../../lib/api-client";
import { summaryCsv } from "./export";
import { WorkerRequest, type WorkerResponse } from "./grid-protocol";
import { jsonTrips, type LocalTrips } from "./local-dataset";

let key = "";
let generation = 0;
let query: TripQuery = { filters: {}, sort: "newest" };
let complete: LocalTrips | undefined;
let pages: Extract<TripDataset, { scope: "server-window" }>[] = [];
let start = 0;
let count = 40;
let controller = new AbortController();
let detailController = new AbortController();
let stepping = false;
let ready = false;
let selection = 0;
const counts = new Map<string, number>();
let countsRevision = 0;
let visibleIds: string[] = [];
let counting = false;
function publishCounts(error = "") {
  send({
    type: "counts",
    key,
    counts: Object.fromEntries(
      visibleIds.flatMap((id) => {
        const count = counts.get(id);
        return count === undefined ? [] : [[id, count]];
      }),
    ),
    error,
  });
}
async function loadCounts() {
  if (counting || !ready) return;
  counting = true;
  const current = generation;
  const revision = countsRevision;
  try {
    while (ready && current === generation && revision === countsRevision) {
      const tripIds = visibleIds.filter((id) => !counts.has(id)).slice(0, 25);
      if (!tripIds.length) break;
      const result = await run(
        request((client) => client.tripCommentCounts({ query: { tripIds } })),
      );
      if (current !== generation || revision !== countsRevision) return;
      if (tripIds.some((id) => result[id] === undefined))
        throw new Error("Missing comment counts");
      for (const id of tripIds) counts.set(id, result[id] ?? 0);
      while (counts.size > 240) {
        const first = counts.keys().next().value;
        if (first === undefined) break;
        counts.delete(first);
      }
      publishCounts();
    }
  } catch {
    if (current === generation && revision === countsRevision)
      publishCounts("Comment counts unavailable");
  } finally {
    counting = false;
    if (ready && (current !== generation || revision !== countsRevision))
      void loadCounts();
  }
}
const send = (message: WorkerResponse) => postMessage(message);
const run = <A, E>(
  effect: Effect.Effect<A, E, ApiClient | Scope.Scope>,
  signal = controller.signal,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ApiClient.layer), Effect.scoped),
    { signal },
  );
const status = (loading: boolean, error = "") =>
  send({
    type: "status",
    key,
    loading,
    error,
    scope: ready ? (complete ? "complete" : "server-window") : "none",
    total: complete ? complete.size : (pages[0]?.total ?? 0),
    loaded: complete
      ? complete.manifest.loaded
      : pages.reduce((n, page) => n + page.loaded, 0),
  });
function show() {
  if (!ready) return;
  const base = complete ? 0 : (pages[0]?.start ?? 0);
  const rows = complete
    ? complete.window(start, count)
    : pages
        .flatMap((page) => page.rows)
        .slice(Math.max(0, start - base), Math.max(0, start - base) + count);
  send({
    type: "window",
    key,
    rows,
    snapshot: (complete?.manifest ?? pages[0])?.snapshot ?? "",
    start: Math.max(base, start),
    base,
    available: complete
      ? complete.size
      : pages.reduce((n, page) => n + page.loaded, 0),
    total: complete ? complete.size : (pages[0]?.total ?? 0),
    previous: !!pages[0]?.previous,
    next: !!pages.at(-1)?.next,
  });
  visibleIds = rows.map((row) => row.trip_id);
  publishCounts();
  void loadCounts();
}
async function step(direction: "next" | "previous") {
  if (complete || stepping || !ready) return;
  const page = direction === "next" ? pages.at(-1) : pages[0];
  const cursor = direction === "next" ? page?.next : page?.previous;
  if (!cursor) return;
  const current = generation;
  stepping = true;
  status(true);
  try {
    const data = await run(
      request((client) => client.tripWindow({ payload: { query, cursor } })),
    );
    if (generation !== current) return;
    if (
      data.scope !== "server-window" ||
      data.snapshot !== page?.snapshot ||
      data.total !== page.total ||
      (direction === "next"
        ? data.start !== page.start + page.loaded
        : data.start + data.loaded !== page.start) ||
      data.queryKey !== tripQueryKey(query) ||
      data.retainedBytes !== retentionCharge(data.rows)
    )
      throw new Error("Invalid window");
    if (direction === "next") {
      pages.push(data);
      if (pages.length > 3) pages.shift();
    } else {
      pages.unshift(data);
      if (pages.length > 3) pages.pop();
    }
    // Charge all retained windows against the configured byte budget.
    while (
      pages.length > 1 &&
      (pages.reduce((n, p) => n + p.retainedBytes, 0) > data.budget.bytes ||
        pages.reduce((n, p) => n + p.loaded, 0) > data.budget.rows)
    ) {
      if (direction === "next") pages.shift();
      else pages.pop();
    }
    start = Math.max(
      pages[0]?.start ?? 0,
      Math.min(
        start,
        (pages.at(-1)?.start ?? 0) + (pages.at(-1)?.loaded ?? 0) - count,
      ),
    );
    show();
    status(false);
  } catch {
    if (generation === current)
      status(
        false,
        "Unable to load more trips. Try scrolling again or reload the query.",
      );
  } finally {
    if (generation === current) stepping = false;
  }
}
async function receive(message: WorkerRequest) {
  switch (message.type) {
    case "invalidate-counts":
      if (message.key === key) {
        countsRevision++;
        counts.clear();
        publishCounts();
        void loadCounts();
      }
      break;
    case "export": {
      if (message.key !== key || !ready || !complete) return;
      const chunks: string[] = [];
      for (let offset = 0; offset < complete.size; offset += 80)
        chunks.push(summaryCsv(complete.window(offset, 80), offset === 0));
      if (!chunks.length) chunks.push(summaryCsv([]));
      send({
        type: "export",
        key,
        csv: chunks.join("\r\n"),
        filename: "taxi-trip-summaries-complete-result.csv",
      });
      break;
    }
    case "query": {
      controller.abort();
      detailController.abort();
      controller = new AbortController();
      key = message.key;
      query = message.query;
      selection++;
      generation++;
      visibleIds = [];
      if (message.force) {
        countsRevision++;
        counts.clear();
      }
      const current = generation;
      stepping = false;
      ready = false;
      start = 0;
      status(true);
      try {
        if (
          complete &&
          !message.force &&
          containsQuery(complete.manifest.query.filters, query.filters)
        ) {
          await complete.query(query, controller.signal);
        } else {
          // Release the old dataset before downloading the replacement.
          complete?.release();
          complete = undefined;
          pages = [];
          const data = await run(
            request((client) => client.tripDataset({ payload: query })),
          );
          if (generation !== current) return;
          if (
            data.queryKey !== tripQueryKey(query) ||
            data.retainedBytes !== retentionCharge(data.rows)
          )
            throw new Error("Invalid dataset");
          if (data.scope === "complete") complete = jsonTrips(data);
          else pages = [data];
          if (complete) await complete.query(query, controller.signal);
        }
        if (generation !== current) return;
        ready = true;
        show();
        status(false);
      } catch {
        if (generation === current) {
          ready = false;
          complete?.release();
          complete = undefined;
          pages = [];
          status(false, "Unable to load trips. Reload the query to try again.");
        }
      }
      break;
    }
    case "range": {
      if (message.key !== key || !ready) return;
      start = Math.max(0, message.start);
      count = message.count;
      show();
      const end = (pages.at(-1)?.start ?? 0) + (pages.at(-1)?.loaded ?? 0);
      const available = pages.reduce((n, page) => n + page.loaded, 0);
      // A budget smaller than a viewport uses explicit continuation buttons;
      // automatic prefetch must never chase every page without a scroll.
      if (!complete && available > count + 40 && start + count >= end - 40)
        void step("next");
      else if (
        !complete &&
        available > count + 40 &&
        start <= (pages[0]?.start ?? 0) + 20
      )
        void step("previous");
      break;
    }
    case "step":
      if (message.key === key) await step(message.direction);
      break;
    case "inspect": {
      if (message.key !== key || !ready) return;
      const current = generation;
      const serial = ++selection;
      detailController.abort();
      detailController = new AbortController();
      const dataset = complete?.manifest ?? pages[0];
      if (!dataset) return;
      try {
        const trip = await run(
          request((client) =>
            client.tripDetail({
              payload: { tripId: message.tripId, snapshot: dataset.snapshot },
            }),
          ),
          detailController.signal,
        );
        if (current === generation && serial === selection)
          send({ type: "selected", key, trip });
      } catch {
        if (current === generation && serial === selection)
          status(false, "Unable to open this trip. Select it again to retry.");
      }
      break;
    }
  }
}
addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = Schema.decodeUnknownOption(WorkerRequest)(event.data);
  if (parsed._tag === "Some") void receive(parsed.value);
  else status(false, "The grid request is invalid. Reload the query.");
});
