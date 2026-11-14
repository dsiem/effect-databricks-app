import { Menu, Tooltip } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../shared/domain";
import * as Filters from "../features/filters/messages";
import * as Genie from "../features/genie/messages";
import { History } from "../features/genie/model";
import * as PickupMap from "../features/map/messages";
import * as Overview from "../features/overview/messages";
import * as SavedViews from "../features/saved-views/messages";
import * as Trips from "../features/trips/messages";
import { uiMessages } from "../lib/ui-messages";
import { ThemePreference } from "./theme";
export const Message = defineMessageUnion({
  ...uiMessages,
  Navigated: { path: Schema.String, query: Schema.String },
  Navigate: { href: Schema.String, external: Schema.Boolean },
  Booted: {
    turns: History,
    persistenceError: Schema.String,
    sidebar: Schema.Boolean,
    mobile: Schema.Boolean,
    themePreference: ThemePreference,
  },
  Resized: { mobile: Schema.Boolean },
  ToggleSidebar: {},
  ThemeMenu: { message: Menu.Message },
  SystemThemeChanged: {},
  Tooltip: { id: Schema.String, message: Tooltip.Message },
  LoadedMetadata: { data: Schema.NullOr(D.Metadata), error: Schema.String },
  LoadedStatus: { data: Schema.NullOr(D.Status), error: Schema.String },
  LoadedUser: { user: Schema.NullOr(D.CurrentUser) },
  ...Filters.messages,
  ...Overview.messages,
  ...Trips.messages,
  ...SavedViews.messages,
  ...Genie.messages,
  ...PickupMap.messages,
});
export type Message = typeof Message.Type;
