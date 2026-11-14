import { Tooltip } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../shared/domain";
import * as Filters from "../features/filters/model";
import { href } from "../features/filters/query";
import * as Genie from "../features/genie/model";
import * as PickupMap from "../features/map/model";
import * as Overview from "../features/overview/model";
import * as SavedViews from "../features/saved-views/model";
import * as Trips from "../features/trips/model";
import { request } from "../lib/request-state";
import { Dialogs } from "./ui-state";
export const Model = Schema.Struct({
  path: Schema.String,
  query: Schema.String,
  sidebar: Schema.Boolean,
  mobile: Schema.Boolean,
  mobileNavigation: Schema.Boolean,
  tooltips: Schema.Record(Schema.String, Tooltip.Model),
  dialogs: Dialogs,
  metadata: request(D.Metadata),
  status: request(D.Status),
  user: Schema.NullOr(D.CurrentUser),
  filtersState: Filters.Model,
  overviewState: Overview.Model,
  tripsState: Trips.Model,
  savedViewsState: SavedViews.Model,
  genieState: Genie.Model,
  mapState: PickupMap.Model,
});
export type Model = typeof Model.Type;
export const requestKey = (model: Model) =>
  `${href(model.path, model.query)}#${model.tripsState.page}:${model.tripsState.sort}`;
export const navigation = [
  { path: "/", label: "Overview", icon: "layout-dashboard" },
  { path: "/trips", label: "Trip explorer", icon: "table-2" },
  { path: "/map", label: "Pickup map", icon: "map" },
] as const;
export const pageContext = (model: Model): D.GenieContext => {
  const overview = model.overviewState.overview.data;
  const trips = model.tripsState.trips.data;
  switch (model.path) {
    case "/":
      return {
        page: "overview",
        title: "Trip overview",
        ...(overview && !model.overviewState.overview.error
          ? {
              data: JSON.stringify({
                summary: overview.summary,
                dailyMetric: model.overviewState.series,
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
        title: `Trip records · page ${model.tripsState.page}`,
        ...(trips && !model.tripsState.trips.error
          ? {
              data: JSON.stringify({
                page: model.tripsState.page,
                sort: model.tripsState.sort,
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
        model.mapState.mappedTrips !== null &&
        !model.mapState.mapError &&
        !model.overviewState.overview.error
          ? {
              data: JSON.stringify({
                topPickupZIPs: overview.zones.slice(0, 10),
                totalTrips: overview.summary.trips,
                mappedTrips: model.mapState.mappedTrips,
                geography:
                  "NYC Health MODZCTA; postal ZIPs may be grouped; trips outside boundaries are not drawn.",
                queriedAt: overview.queriedAt,
              }),
            }
          : {}),
      };
    default:
      return { page: "genie", title: "Taxi trip data" };
  }
};
