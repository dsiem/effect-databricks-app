import type { Trip } from "../../../../shared/domain";
import {
  containsQuery,
  retentionCharge,
  type TripDataset,
  type TripQuery,
  tripQueryKey,
} from "../../../../shared/trip-dataset";
import { summaryCsv } from "./export";
import type { WorkerRequest, WorkerResponse } from "./grid-protocol";
import { jsonTrips, type LocalTrips } from "./local-dataset";

type Page = Extract<TripDataset, { scope: "server-window" }>;
type Resource =
  | { readonly kind: "empty" }
  | { readonly kind: "complete"; readonly trips: LocalTrips }
  | { readonly kind: "server-window"; readonly pages: [Page, ...Page[]] };
type QueryRun = {
  readonly key: string;
  readonly query: TripQuery;
  readonly controller: AbortController;
  detailController: AbortController;
  selection: number;
  ready: boolean;
  stepping: boolean;
  start: number;
  count: number;
  visibleIds: string[];
};
export interface TripApi {
  dataset(query: TripQuery, signal: AbortSignal): Promise<TripDataset>;
  window(
    query: TripQuery,
    cursor: string,
    signal: AbortSignal,
  ): Promise<TripDataset>;
  detail(tripId: string, snapshot: string, signal: AbortSignal): Promise<Trip>;
  counts(
    ids: string[],
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, number>>>;
}
export function createDatasetSession({
  api,
  emit,
}: {
  readonly api: TripApi;
  readonly emit: (message: WorkerResponse) => void;
}) {
  let current: QueryRun | undefined;
  let disposed = false;
  let resource: Resource = { kind: "empty" };
  const counts = new Map<string, number>();
  let countsRevision = 0;
  let counting = false;
  const active = (run: QueryRun) => !disposed && current === run;
  const release = () => {
    if (resource.kind === "complete") resource.trips.release();
    resource = { kind: "empty" };
  };
  const status = (run: QueryRun, loading: boolean, error = "") => {
    if (!active(run)) return;
    emit({
      type: "status",
      key: run.key,
      loading,
      error,
      scope: run.ready
        ? resource.kind === "empty"
          ? "none"
          : resource.kind
        : "none",
      total:
        resource.kind === "complete"
          ? resource.trips.size
          : resource.kind === "server-window"
            ? resource.pages[0].total
            : 0,
      loaded:
        resource.kind === "complete"
          ? resource.trips.manifest.loaded
          : resource.kind === "server-window"
            ? resource.pages.reduce((n, page) => n + page.loaded, 0)
            : 0,
    });
  };
  const publishCounts = (run: QueryRun, error = "") => {
    if (!active(run)) return;
    emit({
      type: "counts",
      key: run.key,
      counts: Object.fromEntries(
        run.visibleIds.flatMap((id) => {
          const count = counts.get(id);
          return count === undefined ? [] : [[id, count]];
        }),
      ),
      error,
    });
  };
  async function loadCounts(run: QueryRun) {
    if (counting || !active(run) || !run.ready) return;
    counting = true;
    const revision = countsRevision;
    try {
      while (active(run) && run.ready && revision === countsRevision) {
        const ids = run.visibleIds.filter((id) => !counts.has(id)).slice(0, 25);
        if (!ids.length) break;
        const result = await api.counts(ids, run.controller.signal);
        if (!active(run) || revision !== countsRevision) return;
        if (ids.some((id) => result[id] === undefined))
          throw new Error("Missing comment counts");
        for (const id of ids) counts.set(id, result[id] ?? 0);
        while (counts.size > 240) {
          const first = counts.keys().next().value;
          if (first === undefined) break;
          counts.delete(first);
        }
        publishCounts(run);
      }
    } catch {
      if (active(run) && revision === countsRevision)
        publishCounts(run, "Comment counts unavailable");
    } finally {
      counting = false;
      // The old runner owns cleanup. Its successor starts only after it exits.
      if (current?.ready && (!active(run) || revision !== countsRevision))
        void loadCounts(current);
    }
  }
  function show(run: QueryRun) {
    if (!active(run) || !run.ready || resource.kind === "empty") return;
    const base = resource.kind === "complete" ? 0 : resource.pages[0].start;
    const rows =
      resource.kind === "complete"
        ? resource.trips.window(run.start, run.count)
        : resource.pages
            .flatMap((page) => page.rows)
            .slice(
              Math.max(0, run.start - base),
              Math.max(0, run.start - base) + run.count,
            );
    emit({
      type: "window",
      key: run.key,
      rows,
      snapshot:
        resource.kind === "complete"
          ? resource.trips.manifest.snapshot
          : resource.pages[0].snapshot,
      start: Math.max(base, run.start),
      base,
      available:
        resource.kind === "complete"
          ? resource.trips.size
          : resource.pages.reduce((n, page) => n + page.loaded, 0),
      total:
        resource.kind === "complete"
          ? resource.trips.size
          : resource.pages[0].total,
      previous:
        resource.kind === "server-window" && !!resource.pages[0].previous,
      next: resource.kind === "server-window" && !!resource.pages.at(-1)?.next,
    });
    run.visibleIds = rows.map((row) => row.trip_id);
    publishCounts(run);
    void loadCounts(run);
  }
  async function step(run: QueryRun, direction: "next" | "previous") {
    if (
      !active(run) ||
      resource.kind !== "server-window" ||
      run.stepping ||
      !run.ready
    )
      return;
    const pages = resource.pages;
    const page = direction === "next" ? (pages.at(-1) ?? pages[0]) : pages[0];
    const cursor = direction === "next" ? page.next : page.previous;
    if (!cursor) return;
    run.stepping = true;
    status(run, true);
    try {
      const data = await api.window(run.query, cursor, run.controller.signal);
      if (!active(run)) return;
      if (
        data.scope !== "server-window" ||
        data.snapshot !== page.snapshot ||
        data.total !== page.total ||
        (direction === "next"
          ? data.start !== page.start + page.loaded
          : data.start + data.loaded !== page.start) ||
        data.queryKey !== tripQueryKey(run.query) ||
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
      while (
        pages.length > 1 &&
        (pages.reduce((n, p) => n + p.retainedBytes, 0) > data.budget.bytes ||
          pages.reduce((n, p) => n + p.loaded, 0) > data.budget.rows)
      ) {
        if (direction === "next") pages.shift();
        else pages.pop();
      }
      const last = pages.at(-1) ?? pages[0];
      run.start = Math.max(
        pages[0].start,
        Math.min(run.start, last.start + last.loaded - run.count),
      );
      show(run);
      status(run, false);
    } catch {
      status(
        run,
        false,
        "Unable to load more trips. Try scrolling again or reload the query.",
      );
    } finally {
      run.stepping = false;
    }
  }
  async function receive(message: WorkerRequest): Promise<void> {
    if (disposed) return;
    if (message.type === "query") {
      current?.controller.abort();
      current?.detailController.abort();
      const viewportCount = current?.count ?? 40;
      const run: QueryRun = {
        key: message.key,
        query: message.query,
        controller: new AbortController(),
        detailController: new AbortController(),
        selection: 0,
        ready: false,
        stepping: false,
        start: 0,
        count: viewportCount,
        visibleIds: [],
      };
      current = run;
      if (message.force) {
        countsRevision++;
        counts.clear();
      }
      status(run, true);
      try {
        if (
          resource.kind === "complete" &&
          !message.force &&
          containsQuery(
            resource.trips.manifest.query.filters,
            run.query.filters,
          )
        ) {
          await resource.trips.query(run.query, run.controller.signal);
        } else {
          release();
          const data = await api.dataset(run.query, run.controller.signal);
          if (!active(run)) return;
          if (
            data.queryKey !== tripQueryKey(run.query) ||
            data.retainedBytes !== retentionCharge(data.rows)
          )
            throw new Error("Invalid dataset");
          resource =
            data.scope === "complete"
              ? { kind: "complete", trips: jsonTrips(data) }
              : { kind: "server-window", pages: [data] };
          if (resource.kind === "complete")
            await resource.trips.query(run.query, run.controller.signal);
        }
        if (!active(run)) return;
        run.ready = true;
        show(run);
        status(run, false);
      } catch {
        if (active(run)) {
          run.ready = false;
          release();
          status(
            run,
            false,
            "Unable to load trips. Reload the query to try again.",
          );
        }
      }
      return;
    }
    const run = current;
    if (!run || message.key !== run.key) return;
    switch (message.type) {
      case "invalidate-counts":
        countsRevision++;
        counts.clear();
        publishCounts(run);
        void loadCounts(run);
        break;
      case "export": {
        if (!run.ready || resource.kind !== "complete") return;
        const chunks: string[] = [];
        for (let offset = 0; offset < resource.trips.size; offset += 80)
          chunks.push(
            summaryCsv(resource.trips.window(offset, 80), offset === 0),
          );
        if (!chunks.length) chunks.push(summaryCsv([]));
        emit({
          type: "export",
          key: run.key,
          csv: chunks.join("\r\n"),
          filename: "taxi-trip-summaries-complete-result.csv",
        });
        break;
      }
      case "range": {
        if (!run.ready) return;
        run.start = Math.max(0, message.start);
        run.count = message.count;
        show(run);
        if (resource.kind !== "server-window") return;
        const pages = resource.pages;
        const last = pages.at(-1) ?? pages[0];
        const end = last.start + last.loaded;
        const available = pages.reduce((n, page) => n + page.loaded, 0);
        // Tiny caches use explicit continuation instead of chasing all pages.
        if (available > run.count + 40 && run.start + run.count >= end - 40)
          void step(run, "next");
        else if (available > run.count + 40 && run.start <= pages[0].start + 20)
          void step(run, "previous");
        break;
      }
      case "step":
        await step(run, message.direction);
        break;
      case "inspect": {
        if (!run.ready || resource.kind === "empty") return;
        const serial = ++run.selection;
        run.detailController.abort();
        run.detailController = new AbortController();
        const snapshot =
          resource.kind === "complete"
            ? resource.trips.manifest.snapshot
            : resource.pages[0].snapshot;
        try {
          const trip = await api.detail(
            message.tripId,
            snapshot,
            run.detailController.signal,
          );
          if (active(run) && serial === run.selection)
            emit({ type: "selected", key: run.key, trip });
        } catch {
          if (active(run) && serial === run.selection)
            status(
              run,
              false,
              "Unable to open this trip. Select it again to retry.",
            );
        }
        break;
      }
    }
  }
  return {
    receive,
    invalidRequest() {
      if (current)
        status(
          current,
          false,
          "The grid request is invalid. Reload the query.",
        );
      else if (!disposed)
        emit({
          type: "status",
          key: "",
          loading: false,
          error: "The grid request is invalid. Reload the query.",
          scope: "none",
          total: 0,
          loaded: 0,
        });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current?.controller.abort();
      current?.detailController.abort();
      current = undefined;
      counts.clear();
      release();
    },
  };
}
