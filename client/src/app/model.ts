import { Dialog, Menu, Tooltip } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../shared/domain";
import { filtersFromQuery, href } from "../domain/filters";
import * as Filters from "../features/filters/model";
import * as Genie from "../features/genie/model";
import { gpsContext } from "../features/gps/context";
import * as Gps from "../features/gps/model";
import * as Overview from "../features/overview/model";
import * as SavedViews from "../features/saved-views/model";
import * as Trips from "../features/trips/model";
import { request } from "../lib/request-state";
import { ThemePreference } from "./theme";
export const Model = Schema.Struct({
  path: Schema.String,
  query: Schema.String,
  sidebar: Schema.Boolean,
  themePreference: ThemePreference,
  themeMenu: Menu.Model,
  mobile: Schema.Boolean,
  mobileNavigation: Schema.Boolean,
  tooltips: Schema.Record(Schema.String, Tooltip.Model),
  navigationDialog: Dialog.Model,
  metadata: request(D.Metadata),
  status: request(D.Status),
  user: Schema.NullOr(D.CurrentUser),
  filtersState: Filters.Model,
  overviewState: Overview.Model,
  tripsState: Trips.Model,
  savedViewsState: SavedViews.Model,
  genieState: Genie.Model,
  gpsState: Gps.Model,
});
export type Model = typeof Model.Type;
export const requestKey = (model: Model) =>
  `${href(model.path, model.query)}#${model.tripsState.page}:${model.tripsState.sort}`;
export const navigation = [
  { path: "/", label: "Overview", icon: "layout-dashboard" },
  { path: "/trips", label: "Trip explorer", icon: "table-2" },
  { path: "/trip-map", label: "Trip map", icon: "map" },
] as const;
export const pageContext = (model: Model): D.GenieContext => {
  const overview = model.overviewState.overview.data;
  const trips = model.tripsState.trips.data;
  switch (model.path) {
    case "/trip-map":
      return gpsContext(model.gpsState, filtersFromQuery(model.query) ?? {});
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
    case "/trips-preview": {
      const state = model.tripsState;
      const window = state.gridWindow;
      return {
        page: "trips",
        title: "Matching trip summaries",
        data: JSON.stringify({
          query: { filters: filtersFromQuery(model.query), sort: state.sort },
          scope: state.gridStatus.scope,
          loading: state.gridStatus.loading,
          error: state.gridStatus.error,
          totalMatchingTrips: state.gridStatus.total,
          loadedTrips: state.gridStatus.loaded,
          selectedTripId: state.selectedTrip?.trip_id ?? null,
          ...(window && window.key === state.gridKey && !state.gridStatus.error
            ? {
                snapshot: window.snapshot,
                visibleStart: window.start,
                visibleCount: window.visible,
                visibleSample: window.sample,
              }
            : {}),
        }),
      };
    }
    case "/trips":
      return {
        page: "trips",
        title: `Trip records · page ${model.tripsState.page}`,
        ...(trips &&
        !model.tripsState.trips.loading &&
        !model.tripsState.trips.error
          ? {
              data: JSON.stringify({
                page: model.tripsState.page,
                sort: model.tripsState.sort,
                totalMatchingTrips: trips.total,
                pageSize: trips.pageSize,
                filters: filtersFromQuery(model.query),
                scope: "page-subset",
                selectedTripId: model.tripsState.selectedTrip?.trip_id ?? null,
                visibleCount: trips.rows.length,
                visibleSample: trips.rows.slice(0, 5),
              }),
            }
          : {}),
      };
    default:
      return { page: "genie", title: "Taxi trip data" };
  }
};
