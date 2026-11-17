// biome-ignore-all lint/style/noNonNullAssertion: Row indices are built from this resource’s validated, fixed-length columns.
import type { TripSummary } from "../../../../shared/domain";
import {
  compareTrips,
  matchesTrip,
  type TripDataset,
  type TripQuery,
} from "../../../../shared/trip-dataset";
import { queryIndices } from "./query-indices";

export interface LocalTrips {
  readonly manifest: {
    readonly query: TripQuery;
    readonly snapshot: string;
    readonly loaded: number;
  };
  readonly size: number;
  query(query: TripQuery, signal: AbortSignal): Promise<void>;
  window(start: number, count: number): ReadonlyArray<TripSummary>;
  release(): void;
}
export function jsonTrips(
  dataset: Extract<TripDataset, { scope: "complete" }>,
): LocalTrips {
  let rows = dataset.rows;
  let indices = new Uint32Array(0);
  const lifetime = new AbortController();
  return {
    manifest: {
      query: dataset.query,
      snapshot: dataset.snapshot,
      loaded: dataset.loaded,
    },
    get size() {
      return indices.length;
    },
    async query(query, signal) {
      indices = await queryIndices(
        {
          length: rows.length,
          matches: (i) => matchesTrip(rows[i]!, query.filters),
          compare: (a, b) => compareTrips(rows[a]!, rows[b]!, query.sort),
        },
        AbortSignal.any([signal, lifetime.signal]),
      );
    },
    window: (start, count) =>
      Array.from(indices.subarray(start, start + count), (i) => rows[i]!),
    release() {
      lifetime.abort();
      rows = [];
      indices = new Uint32Array(0);
    },
  };
}
