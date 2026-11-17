import { Schema } from "effect";
import { Filters, TripSort, TripSummary } from "./domain.js";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const TripQuery = Schema.Struct({ filters: Filters, sort: TripSort });
export type TripQuery = typeof TripQuery.Type;
export const DatasetBudget = Schema.Struct({
  rows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100000 })),
  bytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1024, maximum: 268435456 }),
  ),
});
export type DatasetBudget = typeof DatasetBudget.Type;
export const defaultDatasetBudget: DatasetBudget = {
  rows: 20000,
  bytes: 33554432,
};
export const maxServerWindowRows = 5000;
export const serverWindowSize = (budget: DatasetBudget) =>
  Math.min(
    maxServerWindowRows,
    budget.rows,
    Math.max(1, Math.floor(budget.bytes / 2048)),
  );
const Token = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8192),
);
const manifest = {
  schemaVersion: Schema.Literal(1),
  query: TripQuery,
  queryKey: Schema.String,
  snapshot: Token,
  datasetKey: Schema.String,
  total: Count,
  loaded: Count,
  budget: DatasetBudget,
  // Conservative retention charge: UTF8 JSON bytes * 4, including indices/copies.
  retainedBytes: Count,
  rows: Schema.Array(TripSummary),
};
export const CompleteTrips = Schema.Struct({
  ...manifest,
  scope: Schema.Literal("complete"),
}).check(
  Schema.makeFilter(
    (data) =>
      data.loaded === data.total &&
      data.rows.length === data.total &&
      data.loaded <= data.budget.rows &&
      data.retainedBytes <= data.budget.bytes &&
      new Set(data.rows.map((row) => row.trip_id)).size === data.loaded,
  ),
);
export const ServerTrips = Schema.Struct({
  ...manifest,
  scope: Schema.Literal("server-window"),
  start: Count,
  previous: Schema.NullOr(Token),
  next: Schema.NullOr(Token),
}).check(
  Schema.makeFilter(
    (data) =>
      data.loaded === data.rows.length &&
      data.loaded <= serverWindowSize(data.budget) &&
      data.loaded <= data.budget.rows &&
      data.start + data.loaded <= data.total &&
      data.retainedBytes <= data.budget.bytes,
  ),
);
export const TripDataset = Schema.Union([CompleteTrips, ServerTrips]);
export type TripDataset = typeof TripDataset.Type;
export const TripWindowInput = Schema.Struct({
  query: TripQuery,
  cursor: Token,
});
export const TripDetailInput = Schema.Struct({
  tripId: TripSummary.fields.trip_id,
  snapshot: Token,
});

// Fixed key order makes omitted filters and object insertion order immaterial.
export const tripQueryKey = ({ filters, sort }: TripQuery) =>
  JSON.stringify({
    from: filters.from ?? null,
    to: filters.to ?? null,
    zip: filters.zip ?? null,
    sort,
  });
// Binary comparison, never localeCompare: IDs and timestamps are ASCII, ZIPs are digits.
export function compareTrips(
  a: TripSummary,
  b: TripSummary,
  sort: TripQuery["sort"],
): number {
  const primary =
    sort === "fare"
      ? b.fare - a.fare
      : sort === "distance"
        ? b.distance - a.distance
        : a.pickup_at < b.pickup_at
          ? 1
          : a.pickup_at > b.pickup_at
            ? -1
            : 0;
  return (
    primary || (a.trip_id < b.trip_id ? -1 : a.trip_id > b.trip_id ? 1 : 0)
  );
}
export const matchesTrip = (row: TripSummary, { from, to, zip }: Filters) =>
  (!from || row.pickup_at.slice(0, 10) >= from) &&
  (!to || row.pickup_at.slice(0, 10) <= to) &&
  (!zip || row.pickup_zip === zip);
export const containsQuery = (base: Filters, next: Filters) =>
  (!base.from || (!!next.from && next.from >= base.from)) &&
  (!base.to || (!!next.to && next.to <= base.to)) &&
  (!base.zip || base.zip === next.zip);
export const retentionCharge = (rows: ReadonlyArray<TripSummary>) =>
  new TextEncoder().encode(JSON.stringify(rows)).byteLength * 4;
