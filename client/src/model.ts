import { Schema } from "effect";
import * as D from "../../src/domain";

export const TurnBase = {
  id: Schema.String,
  question: Schema.String,
  filters: Schema.optionalKey(D.Filters),
  context: Schema.optionalKey(D.GenieContext),
};
export const Turn = Schema.Union([
  Schema.Struct({ ...TurnBase, state: Schema.Literal("submitting") }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literals(["submission-rejected", "submission-unknown"]),
    error: Schema.String,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literals(["waiting", "retrieving"]),
    operation: D.GenieOperation,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("paused"),
    operation: D.GenieOperation,
    stage: Schema.Literals(["waiting", "retrieving"]),
    error: Schema.String,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("failed"),
    operation: D.GenieOperation,
    error: Schema.String,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("complete"),
    reply: D.GenieReply,
  }),
]);
export type Turn = typeof Turn.Type;
export const turnBase = ({ id, question, filters, context }: Turn) => ({
  id,
  question,
  ...(filters ? { filters } : {}),
  ...(context ? { context } : {}),
});
export const History = Schema.Array(Turn);
export const FilterDraft = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  zip: Schema.String,
});
export const Sort = Schema.Literals(["newest", "fare", "distance"]);
const request = <S extends Schema.Top>(data: S) =>
  Schema.Struct({
    data: Schema.NullOr(data),
    error: Schema.String,
    loading: Schema.Boolean,
  });
export const NoteEditor = Schema.Struct({
  draft: D.NoteInput,
  view: Schema.Boolean,
  saving: Schema.Boolean,
  error: Schema.String,
});
export const CommentDraft = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
});
export const Model = Schema.Struct({
  path: Schema.String,
  query: Schema.String,
  filterDraft: FilterDraft,
  sidebar: Schema.Boolean,
  mobile: Schema.Boolean,
  mobileNavigation: Schema.Boolean,
  tooltip: Schema.String,
  metadata: request(D.Metadata),
  status: request(D.Status),
  user: Schema.NullOr(D.CurrentUser),
  overview: request(D.Overview),
  trips: request(D.Trips),
  page: Schema.Number,
  sort: Sort,
  sortOpen: Schema.Boolean,
  series: Schema.Literals(["trips", "revenue"]),
  notes: request(D.Notes),
  notePages: Schema.Number,
  savedViews: Schema.Boolean,
  editor: Schema.NullOr(NoteEditor),
  deleting: Schema.NullOr(D.Note),
  noteBusy: Schema.Boolean,
  noteError: Schema.String,
  saved: Schema.NullOr(
    Schema.Struct({ title: Schema.String, query: Schema.String }),
  ),
  selectedTrip: Schema.NullOr(D.Trip),
  comments: request(D.TripComments),
  commentDrafts: Schema.Record(Schema.String, CommentDraft),
  posting: Schema.NullOr(D.TripCommentInput),
  postError: Schema.String,
  posted: Schema.String,
  calendar: Schema.Boolean,
  calendarMonth: Schema.String,
  calendarEnd: Schema.Boolean,
  genieOpen: Schema.Boolean,
  genieExpanded: Schema.Boolean,
  genieDraft: Schema.String,
  genieSelection: Schema.NullOr(D.GenieContext),
  turns: History,
  persistenceError: Schema.String,
  clipboard: Schema.String,
  mappedTrips: Schema.NullOr(Schema.Number),
  mapError: Schema.String,
});
export type Model = typeof Model.Type;
export const filtersFromQuery = (query: string) => {
  const parsed = Schema.decodeUnknownOption(D.Filters)(
    Object.fromEntries(new URLSearchParams(query)),
  );
  return parsed._tag === "Some" ? parsed.value : null;
};
export const filterError =
  "Check the dates and five-digit ZIP code. The start date must be on or before the end date.";
export const queryFor = (filters: D.Filters) =>
  new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
export const href = (path: string, query: string) =>
  path + (query ? `?${query}` : "");
export const requestKey = (model: Model) =>
  `${href(model.path, model.query)}#${model.page}:${model.sort}`;
export const busy = (model: Model) =>
  model.turns.some((turn) =>
    ["submitting", "waiting", "retrieving"].includes(turn.state),
  );
export const navigation = [
  { path: "/", label: "Overview", icon: "layout-dashboard" },
  { path: "/trips", label: "Trip explorer", icon: "table-2" },
  { path: "/map", label: "Pickup map", icon: "map" },
  { path: "/notebook", label: "Saved views", icon: "book-open" },
] as const;
export const pageContext = (model: Model): D.GenieContext => {
  const overview = model.overview.data;
  const trips = model.trips.data;
  switch (model.path) {
    case "/":
      return {
        page: "overview",
        title: "Trip overview",
        ...(overview && !model.overview.error
          ? {
              data: JSON.stringify({
                summary: overview.summary,
                dailyMetric: model.series,
                daily: overview.daily,
                hourly: overview.hourly,
                topPickupZIPs: overview.zones.slice(0, 5),
                queriedAt: overview.queriedAt,
              }),
            }
          : {}),
      };
    case "/trips":
      return {
        page: "trips",
        title: `Trip records · page ${model.page}`,
        ...(trips && !model.trips.error
          ? {
              data: JSON.stringify({
                page: model.page,
                sort: model.sort,
                totalMatchingTrips: trips.total,
                pageSize: trips.pageSize,
                visibleRows: trips.rows,
              }),
            }
          : {}),
      };
    case "/map":
      return {
        page: "map",
        title: "Pickup activity by ZIP area",
        ...(overview &&
        model.mappedTrips !== null &&
        !model.mapError &&
        !model.overview.error
          ? {
              data: JSON.stringify({
                topPickupZIPs: overview.zones.slice(0, 10),
                totalTrips: overview.summary.trips,
                mappedTrips: model.mappedTrips,
                geography:
                  "NYC Health MODZCTA; postal ZIPs may be grouped; trips outside boundaries are not drawn.",
                queriedAt: overview.queriedAt,
              }),
            }
          : {}),
      };
    case "/notebook":
      return { page: "notebook", title: "Saved views" };
    default:
      return { page: "genie", title: "Taxi trip data" };
  }
};
