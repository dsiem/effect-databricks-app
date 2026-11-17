import { Dialog, Menu, Tooltip } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../shared/domain";
import { href } from "../domain/filters";
import * as Filters from "../features/filters/model";
import * as Genie from "../features/genie/model";
import * as Gps from "../features/gps/model";
import * as Overview from "../features/overview/model";
import * as SavedViews from "../features/saved-views/model";
import * as Trips from "../features/trips/model";
import { request } from "../lib/request-state";
import { Location, paths, routePath } from "./route";
import { ThemePreference } from "./theme";
export const Model = Schema.Struct({
  location: Location,
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
export const overviewRequestKey = ({ location }: Model) =>
  href(routePath(location.route), location.query);
export const navigation = [
  { path: paths.Overview, label: "Overview", icon: "layout-dashboard" },
  { path: paths.Trips, label: "Trip explorer", icon: "table-2" },
  { path: paths.TripMap, label: "Trip map", icon: "map" },
] as const;
