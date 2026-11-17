import { Dialog, Menu, Tooltip } from "@foldkit/ui";
import { Schema } from "effect";
import { Calendar } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../shared/domain";
import * as AnalysisRuns from "../features/analysis-runs/messages";
import * as Filters from "../features/filters/messages";
import * as Genie from "../features/genie/messages";
import * as Gps from "../features/gps/messages";
import * as Overview from "../features/overview/messages";
import * as SavedViews from "../features/saved-views/messages";
import * as Trips from "../features/trips/messages";
import { ThemePreference } from "./theme";
export const Message = defineMessageUnion({
  Idle: {},
  LoadPage: {},
  CloseNavigation: {},
  NavigationDialog: { message: Dialog.Message },
  Navigated: { path: Schema.String, query: Schema.String },
  Navigate: { href: Schema.String, external: Schema.Boolean },
  Booted: {
    sidebar: Schema.Boolean,
    mobile: Schema.Boolean,
    themePreference: ThemePreference,
  },
  Resized: { mobile: Schema.Boolean },
  ToggleSidebar: {},
  ThemeMenu: { message: Menu.Message },
  SystemThemeChanged: {},
  Tooltip: { id: Schema.String, message: Tooltip.Message },
  LoadedMetadata: {
    data: Schema.NullOr(D.Metadata),
    error: Schema.String,
    today: Calendar.CalendarDate,
  },
  LoadedStatus: { data: Schema.NullOr(D.Status), error: Schema.String },
  LoadedUser: { user: Schema.NullOr(D.CurrentUser) },
  ...Filters.messages,
  ...Overview.messages,
  ...Trips.messages,
  ...SavedViews.messages,
  ...Genie.messages,
  ...Gps.messages,
  ...AnalysisRuns.messages,
});
export type Message = typeof Message.Type;
