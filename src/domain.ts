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
const dateOrder = Schema.makeFilter(
  (filters: { readonly from?: string; readonly to?: string }) =>
    !filters.from ||
    !filters.to ||
    filters.from <= filters.to ||
    "The start date must be on or before the end date.",
);
export const Filters = Schema.Struct({
  from: Schema.optionalKey(Day),
  to: Schema.optionalKey(Day),
  zip: Schema.optionalKey(Zip),
}).check(dateOrder);
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
}).check(dateOrder);
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
  trip_id: boundedText(256),
  pickup_at: boundedText(80),
  dropoff_at: boundedText(80),
  pickup_zip: boundedText(32),
  dropoff_zip: boundedText(32),
  distance: Schema.Number,
  fare: Schema.Number,
  duration: Schema.Number,
});
export type Trip = typeof Trip.Type;
export const Trips = Schema.Struct({
  rows: Schema.Array(Trip),
  total: Schema.Number,
  page: Schema.Number,
  pageSize: Schema.Number,
});
export const NoteVersion = Schema.Int.check(Schema.isGreaterThan(0));
export const NoteInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID(4)),
  title: boundedText(160),
  body: Schema.String.check(Schema.isMaxLength(10000)),
  filters: Filters,
  version: Schema.NullOr(NoteVersion),
});
export const NotePin = Schema.Struct({
  version: NoteVersion,
  pinned: Schema.Boolean,
});
export type NotePin = typeof NotePin.Type;
export const Note = Schema.Struct({
  ...NoteInput.fields,
  version: NoteVersion,
  pinned: Schema.Boolean,
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type Note = typeof Note.Type;
export type NoteInput = typeof NoteInput.Type;
export const NoteCursor = Schema.Struct({
  id: NoteInput.fields.id,
  pinned: Schema.Boolean,
  // Preserve PostgreSQL's microseconds when resuming the database ordering.
  updatedAt: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
    Schema.makeFilter(
      (value) =>
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString() === `${value.slice(0, 23)}Z`,
    ),
  ),
});
export type NoteCursor = typeof NoteCursor.Type;
export const NoteSearch = Schema.Struct({
  cursor: Schema.optionalKey(Schema.fromJsonString(NoteCursor)),
});
export type NoteSearch = typeof NoteSearch.Type;
export const Notes = Schema.Struct({
  rows: Schema.Array(Note),
  nextCursor: Schema.NullOr(NoteCursor),
});
export type Notes = typeof Notes.Type;
const GenieId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,100}$/));
export const GenieContext = Schema.Struct({
  page: Schema.Literals(["overview", "trips", "map", "notebook", "genie"]),
  title: boundedText(160),
  // A bounded snapshot of the displayed aggregates or visible records.
  data: Schema.optionalKey(boundedText(24000)),
});
export type GenieContext = typeof GenieContext.Type;
export const GenieInput = Schema.Struct({
  content: boundedText(4000),
  filters: Schema.optionalKey(Filters),
  context: Schema.optionalKey(GenieContext),
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

export const CapabilityAvailability = Schema.Literals([
  "unconfigured",
  "unknown",
  "available",
  "unavailable",
]);
export type CapabilityAvailability = typeof CapabilityAvailability.Type;

export const Status = Schema.Struct({
  dataset: Schema.String,
  warehouse: Schema.Boolean,
  genie: Schema.Boolean,
  lakebase: Schema.Boolean,
  capabilities: Schema.Struct({
    warehouse: CapabilityAvailability,
    genie: CapabilityAvailability,
    lakebase: CapabilityAvailability,
  }),
  auth: Schema.String,
});

export const CurrentUser = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NullOr(Schema.NonEmptyString),
});
export type CurrentUser = typeof CurrentUser.Type;

export const TripCommentInput = Schema.Struct({
  id: NoteInput.fields.id,
  trip: Trip,
  body: boundedText(4000).check(
    Schema.makeFilter((body) => body.trim().length > 0),
  ),
});
export type TripCommentInput = typeof TripCommentInput.Type;
export const TripComment = Schema.Struct({
  ...TripCommentInput.fields,
  author: Schema.NullOr(CurrentUser),
  created_at: Schema.String,
});
export type TripComment = typeof TripComment.Type;
export const TripCommentCursor = Schema.Struct({
  id: NoteInput.fields.id,
  createdAt: NoteCursor.fields.updatedAt,
});
export type TripCommentCursor = typeof TripCommentCursor.Type;
export const TripCommentSearch = Schema.Struct({
  trip: Schema.fromJsonString(Trip),
  cursor: Schema.optionalKey(Schema.fromJsonString(TripCommentCursor)),
});
export type TripCommentSearch = typeof TripCommentSearch.Type;
export const TripComments = Schema.Struct({
  rows: Schema.Array(TripComment),
  nextCursor: Schema.NullOr(TripCommentCursor),
});
export type TripComments = typeof TripComments.Type;
