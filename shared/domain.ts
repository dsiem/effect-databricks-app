import {
  GenieAgentPhase,
  GenieAttachmentWarning,
  GenieId,
  GenieOperation as ChatOperation,
  GenieProgress as ChatProgress,
} from "@dsiem/genie-client";
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
export const GpsEndpoint = Schema.Literals(["pickup", "dropoff"]);
export type GpsEndpoint = typeof GpsEndpoint.Type;
export const GpsSearch = Schema.Struct({
  ...Filters.fields,
  endpoint: Schema.optionalKey(GpsEndpoint),
}).check(dateOrder);
export const TripSort = Schema.Literals(["newest", "fare", "distance"]);
export const Id = Schema.String.check(Schema.isUUID(4));
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
export const Coordinates = Schema.Struct({
  longitude: Schema.Number.check(
    Schema.isBetween({ minimum: -180, maximum: 180 }),
  ),
  latitude: Schema.Number.check(
    Schema.isBetween({ minimum: -90, maximum: 90 }),
  ),
});
const GpsRing = Schema.mutable(
  Schema.Array(Schema.mutable(Schema.Tuple([Schema.Number, Schema.Number]))),
);
export const GpsCell = Schema.Struct({
  id: Schema.String,
  longitude: Schema.Number,
  latitude: Schema.Number,
  boundary: Schema.Struct({
    type: Schema.Literal("Polygon"),
    coordinates: Schema.mutable(Schema.Array(GpsRing)),
  }),
  trips: Schema.Number,
  avg_fare: Schema.Number,
  avg_distance: Schema.Number,
  zip: Schema.NullOr(Zip),
});
export type GpsCell = typeof GpsCell.Type;
export const mapCellLimit = 100_000;
export const TripMap = Schema.Struct({
  endpoint: GpsEndpoint,
  matchingTrips: Schema.Number,
  locatedTrips: Schema.Number,
  shownTrips: Schema.Number,
  totalCells: Schema.Number,
  truncated: Schema.Boolean,
  cells: Schema.Array(GpsCell).check(Schema.isMaxLength(mapCellLimit)),
  queriedAt: Schema.String,
});
export type TripMap = typeof TripMap.Type;
export const TripDetails = Schema.Struct({
  source_file: boundedText(160),
  vendor_id: Schema.NullOr(Schema.Int),
  passenger_count: Schema.NullOr(Schema.Int),
  rate_code_id: Schema.NullOr(Schema.Int),
  store_and_fwd_flag: Schema.NullOr(Schema.String),
  payment_type: Schema.NullOr(Schema.Int),
  pickup_location: Schema.NullOr(Coordinates),
  dropoff_location: Schema.NullOr(Coordinates),
  tip_amount: Schema.NullOr(Schema.Number),
  tolls_amount: Schema.NullOr(Schema.Number),
  extra: Schema.NullOr(Schema.Number),
  mta_tax: Schema.NullOr(Schema.Number),
  improvement_surcharge: Schema.NullOr(Schema.Number),
  total_amount: Schema.NullOr(Schema.Number),
});
export const TripSnapshot = Schema.Struct({
  trip_id: boundedText(256),
  pickup_at: boundedText(80),
  dropoff_at: boundedText(80),
  pickup_zip: boundedText(32),
  dropoff_zip: boundedText(32),
  distance: Schema.Number,
  fare: Schema.Number,
  duration: Schema.Number,
  // Lakebase comments retain historical trip snapshots from before enrichment.
  details: Schema.optionalKey(TripDetails),
});
export type TripSnapshot = typeof TripSnapshot.Type;
export const Trip = Schema.Struct({
  ...TripSnapshot.fields,
  details: TripDetails,
});
export type Trip = typeof Trip.Type;
const isDay = Schema.is(Day);
const cursorTimestamp = TripSnapshot.fields.pickup_at.check(
  Schema.isPattern(
    /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/,
  ),
  Schema.makeFilter((value) => isDay(value.slice(0, 10))),
);
export const TripPosition = Schema.Struct({
  trip_id: TripSnapshot.fields.trip_id,
  pickup_at: cursorTimestamp,
  dropoff_at: cursorTimestamp,
  pickup_zip: TripSnapshot.fields.pickup_zip,
  dropoff_zip: TripSnapshot.fields.dropoff_zip,
  fare: Schema.NullOr(Schema.Finite),
  distance: Schema.NullOr(Schema.Finite),
});
export type TripPosition = typeof TripPosition.Type;
export const TripCursor = Schema.Struct({
  filters: Filters,
  sort: TripSort,
  after: TripPosition,
});
export type TripCursor = typeof TripCursor.Type;
export const TripSearch = Schema.Struct({
  ...Filters.fields,
  sort: Schema.optionalKey(TripSort),
  cursor: Schema.optionalKey(Schema.fromJsonString(TripCursor)),
}).check(
  dateOrder,
  Schema.makeFilter(
    ({ cursor, sort, from, to, zip }) =>
      !cursor ||
      (cursor.sort === (sort ?? "newest") &&
        cursor.filters.from === from &&
        cursor.filters.to === to &&
        cursor.filters.zip === zip) ||
      "The trip cursor must match the filters and sort order.",
  ),
);
export type TripSearch = typeof TripSearch.Type;
export const tripPageSize = 25;
export const Trips = Schema.Struct({
  rows: Schema.Array(Trip),
  total: Schema.Number,
  pageSize: Schema.Number,
  nextCursor: Schema.NullOr(TripCursor),
});
export const SavedViewVersion = Schema.Int.check(Schema.isGreaterThan(0));
export const SavedViewInput = Schema.Struct({
  id: Id,
  title: boundedText(160),
  body: Schema.String.check(Schema.isMaxLength(10000)),
  filters: Filters,
  version: Schema.NullOr(SavedViewVersion),
});
export const SavedViewPin = Schema.Struct({
  version: SavedViewVersion,
  pinned: Schema.Boolean,
});
export type SavedViewPin = typeof SavedViewPin.Type;
export const SavedView = Schema.Struct({
  ...SavedViewInput.fields,
  version: SavedViewVersion,
  pinned: Schema.Boolean,
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type SavedView = typeof SavedView.Type;
export type SavedViewInput = typeof SavedViewInput.Type;
export const CursorTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  Schema.makeFilter(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === `${value.slice(0, 23)}Z`,
  ),
);
export const SavedViewCursor = Schema.Struct({
  id: Id,
  pinned: Schema.Boolean,
  // Preserve PostgreSQL's microseconds when resuming the database ordering.
  updatedAt: CursorTimestamp,
});
export type SavedViewCursor = typeof SavedViewCursor.Type;
export const SavedViewSearch = Schema.Struct({
  cursor: Schema.optionalKey(Schema.fromJsonString(SavedViewCursor)),
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  ids: Schema.optionalKey(
    Schema.fromJsonString(Schema.Array(Id).check(Schema.isMaxLength(5))),
  ),
});
export type SavedViewSearch = typeof SavedViewSearch.Type;
export const SavedViewsPage = Schema.Struct({
  rows: Schema.Array(SavedView),
  nextCursor: Schema.NullOr(SavedViewCursor),
});
export type SavedViewsPage = typeof SavedViewsPage.Type;
export const genieContextDataLimit = 24_000;
export const GenieContext = Schema.Struct({
  page: Schema.Literals(["overview", "trips", "map", "saved-views", "genie"]),
  title: boundedText(160),
  // A bounded snapshot of the displayed aggregates or visible records.
  data: Schema.optionalKey(boundedText(genieContextDataLimit)),
});
export type GenieContext = typeof GenieContext.Type;
export const GenieMode = Schema.Literals(["chat", "agent"]);
export type GenieMode = typeof GenieMode.Type;
export const GenieModeQuery = Schema.Struct({
  mode: Schema.optionalKey(GenieMode),
});
export const GenieInput = Schema.Struct({
  content: boundedText(4000),
  filters: Schema.optionalKey(Filters),
  context: Schema.optionalKey(GenieContext),
  conversationId: Schema.optionalKey(GenieId),
  ...GenieModeQuery.fields,
});
export const GeniePath = ChatOperation;
export const GenieAgentPath = Schema.Struct({
  conversationId: GenieId,
  responseId: GenieId,
});
export const GenieQueryPath = Schema.Struct({
  ...GeniePath.fields,
  attachmentId: GenieId,
});
export type GenieQueryPath = typeof GenieQueryPath.Type;
export const GenieOperation = Schema.Struct({
  ...ChatOperation.fields,
  ...GenieModeQuery.fields,
  grant: Schema.optionalKey(Schema.String),
});
export type GenieOperation = typeof GenieOperation.Type;
export { GenieAgentPhase };
export const GenieProgress = Schema.Struct({
  ...ChatProgress.fields,
  phase: Schema.optionalKey(GenieAgentPhase),
  state: Schema.Literals([...ChatProgress.fields.state.literals, "cancelled"]),
  ...GenieModeQuery.fields,
});
export type GenieProgress = typeof GenieProgress.Type;
export const GeniePollProgress = Schema.Union([
  GenieProgress,
  Schema.Struct({
    ...ChatProgress.fields,
    mode: Schema.Literal("agent"),
    state: Schema.Literal("unresolved"),
  }),
]);
export type GeniePollProgress = typeof GeniePollProgress.Type;
export const GenieReply = Schema.Struct({
  ...GenieOperation.fields,
  text: Schema.String,
  warning: Schema.optionalKey(GenieAttachmentWarning),
  queries: Schema.Array(
    Schema.Struct({
      attachmentId: Schema.optionalKey(GenieId),
      sql: Schema.String,
      description: Schema.String,
      columns: Schema.Array(Schema.String),
      rows: Schema.Array(Schema.Array(Schema.NullOr(Schema.String))),
      truncated: Schema.Boolean,
    }),
  ),
});
export type GenieReply = typeof GenieReply.Type;

export const CurrentUser = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NullOr(Schema.NonEmptyString),
});
export type CurrentUser = typeof CurrentUser.Type;

export const TripCommentInput = Schema.Struct({
  id: Id,
  trip: TripSnapshot,
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
  id: Id,
  createdAt: CursorTimestamp,
});
export type TripCommentCursor = typeof TripCommentCursor.Type;
export const TripCommentSearch = Schema.Struct({
  tripId: TripSnapshot.fields.trip_id,
  cursor: Schema.optionalKey(Schema.fromJsonString(TripCommentCursor)),
});
export type TripCommentSearch = typeof TripCommentSearch.Type;
export const TripCommentCountSearch = Schema.Struct({
  tripIds: Schema.fromJsonString(
    Schema.Array(TripSnapshot.fields.trip_id).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(25),
    ),
  ),
});
export type TripCommentCountSearch = typeof TripCommentCountSearch.Type;
export const TripCommentCounts = Schema.Record(
  Schema.String,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
);
export const TripComments = Schema.Struct({
  rows: Schema.Array(TripComment),
  nextCursor: Schema.NullOr(TripCommentCursor),
});
export type TripComments = typeof TripComments.Type;
