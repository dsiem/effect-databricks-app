import { Schema } from "effect";

const boundedText = (max: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
export const Zip = Schema.String.check(Schema.isPattern(/^\d{5}$/));
export const Day = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  ),
);
export const Filters = Schema.Struct({
  from: Schema.optionalKey(Day),
  to: Schema.optionalKey(Day),
  zip: Schema.optionalKey(Zip),
});
export type Filters = typeof Filters.Type;
export const TripSearch = Schema.Struct({
  ...Filters.fields,
  page: Schema.optionalKey(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: 10000 }),
    ),
  ),
  sort: Schema.optionalKey(Schema.Literals(["newest", "fare", "distance"])),
});
export type TripSearch = typeof TripSearch.Type;

export const Summary = Schema.Struct({
  trips: Schema.Number,
  revenue: Schema.Number,
  avg_fare: Schema.Number,
  avg_distance: Schema.Number,
  avg_duration: Schema.Number,
});
export const Daily = Schema.Struct({
  day: Schema.String,
  trips: Schema.Number,
  revenue: Schema.Number,
});
export const Hourly = Schema.Struct({
  hour: Schema.Number,
  trips: Schema.Number,
  avg_fare: Schema.Number,
});
export const Zone = Schema.Struct({
  zip: Schema.String,
  trips: Schema.Number,
  revenue: Schema.Number,
  avg_fare: Schema.Number,
});
export const Metadata = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  trips: Schema.Number,
});
export const Overview = Schema.Struct({
  summary: Summary,
  daily: Schema.Array(Daily),
  hourly: Schema.Array(Hourly),
  zones: Schema.Array(Zone),
  queriedAt: Schema.String,
});
export type Overview = typeof Overview.Type;
export const Trip = Schema.Struct({
  pickup_at: Schema.String,
  dropoff_at: Schema.String,
  pickup_zip: Schema.String,
  dropoff_zip: Schema.String,
  distance: Schema.Number,
  fare: Schema.Number,
  duration: Schema.Number,
});
export const Trips = Schema.Struct({
  rows: Schema.Array(Trip),
  total: Schema.Number,
  page: Schema.Number,
  pageSize: Schema.Number,
});
export const NoteInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID(4)),
  title: boundedText(160),
  body: Schema.String.check(Schema.isMaxLength(10000)),
  filters: Filters,
  pinned: Schema.Boolean,
});
export const Note = Schema.Struct({
  ...NoteInput.fields,
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type Note = typeof Note.Type;
export type NoteInput = typeof NoteInput.Type;
export const Notes = Schema.Array(Note);
const GenieId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,100}$/));
export const GenieInput = Schema.Struct({
  content: boundedText(4000),
  conversationId: Schema.optionalKey(GenieId),
});
export const GenieOperation = Schema.Struct({
  conversationId: GenieId,
  messageId: GenieId,
});
export type GenieOperation = typeof GenieOperation.Type;
export const GenieProgress = Schema.Struct({
  ...GenieOperation.fields,
  state: Schema.Literals(["pending", "completed", "failed"]),
  status: Schema.String,
});
export type GenieProgress = typeof GenieProgress.Type;
export const GenieReply = Schema.Struct({
  ...GenieOperation.fields,
  text: Schema.String,
  queries: Schema.Array(
    Schema.Struct({
      sql: Schema.String,
      description: Schema.String,
      columns: Schema.Array(Schema.String),
      rows: Schema.Array(Schema.Array(Schema.NullOr(Schema.String))),
      truncated: Schema.Boolean,
    }),
  ),
});
export type GenieReply = typeof GenieReply.Type;

export const Status = Schema.Struct({
  dataset: Schema.String,
  warehouse: Schema.Boolean,
  genie: Schema.Boolean,
  lakebase: Schema.Boolean,
  auth: Schema.String,
});

export const CurrentUser = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NullOr(Schema.NonEmptyString),
});
export type CurrentUser = typeof CurrentUser.Type;
