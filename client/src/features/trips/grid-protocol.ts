import { Schema } from "effect";
import {
  Trip,
  TripCommentCounts,
  TripSummary,
} from "../../../../shared/domain";
import { TripQuery } from "../../../../shared/trip-dataset";

export const GridInput = Schema.Struct({
  key: Schema.String,
  query: TripQuery,
  selectedId: Schema.NullOr(Schema.String),
  countsVersion: Schema.Number,
});
export const GridWindow = Schema.Struct({
  key: Schema.String,
  snapshot: Schema.String,
  start: Schema.Number,
  visible: Schema.Number,
  sample: Schema.Array(TripSummary).check(Schema.isMaxLength(5)),
});
export type GridInput = typeof GridInput.Type;
export const GridStatus = Schema.Struct({
  key: Schema.String,
  loading: Schema.Boolean,
  error: Schema.String,
  scope: Schema.Literals(["complete", "server-window", "none"]),
  total: Schema.Number,
  loaded: Schema.Number,
});
export type GridStatus = typeof GridStatus.Type;
const key = { key: Schema.String };
export const WorkerRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("invalidate-counts"), ...key }),
  Schema.Struct({
    type: Schema.Literal("export"),
    ...key,
  }),
  Schema.Struct({
    type: Schema.Literal("query"),
    ...key,
    query: TripQuery,
    force: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("range"),
    ...key,
    start: Schema.Int,
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 80 })),
  }),
  Schema.Struct({
    type: Schema.Literal("step"),
    ...key,
    direction: Schema.Literals(["next", "previous"]),
  }),
  Schema.Struct({
    type: Schema.Literal("inspect"),
    ...key,
    tripId: TripSummary.fields.trip_id,
  }),
]);
export type WorkerRequest = typeof WorkerRequest.Type;
export const WorkerResponse = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("counts"),
    ...key,
    counts: TripCommentCounts,
    error: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("export"),
    ...key,
    csv: Schema.String,
    filename: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("status"), ...GridStatus.fields }),
  Schema.Struct({
    type: Schema.Literal("window"),
    ...key,
    rows: Schema.Array(TripSummary).check(Schema.isMaxLength(80)),
    snapshot: Schema.String,
    start: Schema.Number,
    base: Schema.Number,
    available: Schema.Number,
    total: Schema.Number,
    previous: Schema.Boolean,
    next: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("selected"), ...key, trip: Trip }),
]);
export type WorkerResponse = typeof WorkerResponse.Type;
