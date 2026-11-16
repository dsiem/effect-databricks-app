import { Dialog, Menu, Tooltip } from "@foldkit/ui";
import { Option } from "effect";
import { Command, Update } from "foldkit";
import type { Url } from "foldkit/url";
import { filtersFromQuery, href, queryFor } from "../domain/filters";
import * as FilterDates from "../features/filters/dates";
import * as Filters from "../features/filters/model";
import { updateFilters } from "../features/filters/update";
import * as GenieCommands from "../features/genie/commands";
import * as Genie from "../features/genie/model";
import { presentGenie, updateGenie } from "../features/genie/update";
import * as Gps from "../features/gps/model";
import { updateGps } from "../features/gps/update";
import * as Overview from "../features/overview/model";
import { updateOverview } from "../features/overview/update";
import * as SavedViews from "../features/saved-views/model";
import { updateSavedViews } from "../features/saved-views/update";
import * as Trips from "../features/trips/model";
import { updateTrips } from "../features/trips/update";
import type { ApiClient } from "../lib/api-client";
import { syncDialog } from "../lib/dialog";
import { pending } from "../lib/request-state";
import * as AppCommands from "./commands";
import { Message as M, type Message } from "./message";
import { type Model, pageContext, requestKey } from "./model";
import { loadPage } from "./navigation";
import { ThemeMenu } from "./theme";
import { initTooltip } from "./ui-state";

export function init(url: Url): Update.Return<Model, Message, ApiClient> {
  const query = Option.getOrElse(url.search, () => "").replace(/^\?/, "");
  const filters = filtersFromQuery(query) ?? {};
  const model: Model = {
    path: url.pathname,
    query,
    sidebar: true,
    themePreference: "System",
    themeMenu: Menu.init({ id: "theme" }),
    mobile: false,
    mobileNavigation: false,
    tooltips: {},
    navigationDialog: Dialog.init({
      id: "mobile-navigation",
      focusSelector: "a",
    }),
    metadata: pending,
    status: pending,
    user: null,
    filtersState: Filters.init(filters),
    overviewState: Overview.init(),
    tripsState: Trips.init(),
    savedViewsState: SavedViews.init(),
    genieState: Genie.init(),
    gpsState: Gps.init(),
  };
  const loaded = loadPage(model);
  return {
    ...loaded,
    commands: [
      ...(loaded.commands ?? []),
      AppCommands.Boot(),
      GenieCommands.RestoreConversation(),
      AppCommands.LoadMetadata(),
      AppCommands.LoadStatus(),
      AppCommands.LoadUser(),
    ],
  };
}
function updateApplication(
  model: Model,
  message: Message,
): Update.Return<Model, Message, ApiClient> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "Navigate":
      return { model, commands: [AppCommands.Navigate(message)] };
    case "Navigated": {
      if (model.path === message.path && model.query === message.query)
        return { model: { ...model, mobileNavigation: false } };
      const filters = filtersFromQuery(message.query) ?? {};
      const reset = updateTrips(model.tripsState, M.ResetTrips(), {
        requestKey: requestKey(model),
      });
      const loaded = loadPage({
        ...model,
        path: message.path,
        query: message.query,
        mobileNavigation: false,
        tooltips: {},
        filtersState: FilterDates.reset(
          model.filtersState,
          filters,
          model.metadata.data,
        ),
        savedViewsState: { ...model.savedViewsState, notice: "" },
        tripsState: reset.model,
        genieState: { ...model.genieState, genieSelection: null },
      });
      return {
        ...loaded,
        commands: [...(reset.commands ?? []), ...(loaded.commands ?? [])],
      };
    }
    case "Booted":
      return {
        model: {
          ...model,
          sidebar: message.sidebar,
          mobile: message.mobile,
          themePreference: message.themePreference,
        },
        commands: [
          AppCommands.SetTheme({
            preference: message.themePreference,
            persist: false,
          }),
        ],
      };
    case "ThemeMenu": {
      const changed = ThemeMenu.update(model.themeMenu, message.message);
      const preference = changed.outMessage?.value;
      return {
        model: {
          ...model,
          themeMenu: changed.model,
          themePreference: preference ?? model.themePreference,
        },
        commands: [
          ...(changed.commands ?? []).map((command) =>
            Command.mapMessage(command, (message) => M.ThemeMenu({ message })),
          ),
          ...(preference
            ? [AppCommands.SetTheme({ preference, persist: true })]
            : []),
        ],
      };
    }
    case "SystemThemeChanged":
      return {
        model,
        commands:
          model.themePreference === "System"
            ? [AppCommands.SetTheme({ preference: "System", persist: false })]
            : [],
      };
    case "Resized":
      return {
        model: {
          ...model,
          mobile: message.mobile,
          mobileNavigation: false,
          tooltips: {},
        },
      };
    case "ToggleSidebar":
      return model.mobile
        ? { model: { ...model, mobileNavigation: !model.mobileNavigation } }
        : {
            model: { ...model, sidebar: !model.sidebar, tooltips: {} },
            commands: [AppCommands.PersistSidebar({ open: !model.sidebar })],
          };
    case "CloseNavigation":
      return { model: { ...model, mobileNavigation: false } };
    case "Tooltip":
      return Update.foldChild({
        update: Tooltip.update,
        read: (model: Model) =>
          Option.some(model.tooltips[message.id] ?? initTooltip(message.id)),
        write: (model, child) => ({
          ...model,
          tooltips: { ...model.tooltips, [message.id]: child },
        }),
        toParentMessage: (child) =>
          M.Tooltip({ id: message.id, message: child }),
        foldOutMessage: () => (model) => ({ model }),
      })(model, message.message);
    case "NavigationDialog": {
      const changed = Dialog.update(model.navigationDialog, message.message);
      return {
        model: {
          ...model,
          navigationDialog: changed.model,
          mobileNavigation:
            changed.outMessage?._tag === "Closed"
              ? false
              : model.mobileNavigation,
        },
        commands: (changed.commands ?? []).map((command) =>
          Command.mapMessage(command, (message) =>
            M.NavigationDialog({ message }),
          ),
        ),
      };
    }
    case "LoadedMetadata":
      return {
        model: {
          ...model,
          filtersState: FilterDates.withMetadata(
            model.filtersState,
            message.data,
            message.today,
          ),
          metadata: {
            data: message.data,
            error: message.error,
            loading: false,
          },
        },
      };
    case "LoadedStatus":
      return {
        model: {
          ...model,
          status: { data: message.data, error: message.error, loading: false },
        },
        commands: model.genieState.genieOpen
          ? [AppCommands.Focus({ selector: "#genie-composer" })]
          : [],
      };
    case "LoadedUser":
      return { model: { ...model, user: message.user } };
    case "LoadPage":
      return loadPage(model);
    case "FilterDatePicker":
    case "FilterChanged":
    case "ApplyFilters":
    case "ResetFilters":
    case "PickZip": {
      const changed = updateFilters(model.filtersState, message, {
        query: model.query,
        metadata: model.metadata.data,
      });
      const next = { ...model, filtersState: changed.model };
      return changed.outMessage
        ? {
            model: next,
            commands: [
              AppCommands.Navigate({
                href: href(model.path, changed.outMessage.query),
                external: false,
              }),
            ],
          }
        : { model: next, commands: changed.commands ?? [] };
    }
    case "MetricTabs":
    case "LoadedOverview": {
      const changed = updateOverview(model.overviewState, message, {
        requestKey: requestKey(model),
      });
      const next = { ...model, overviewState: changed.model };
      return {
        model: changed.outMessage
          ? {
              ...next,
              genieState: { ...next.genieState, genieSelection: null },
            }
          : next,
        commands: changed.commands ?? [],
      };
    }
    case "CloseTrip":
    case "ResetTrips":
    case "InspectorDialog":
    case "SetPage":
    case "SortTrips":
    case "ExportTrips":
    case "LoadedTrips":
    case "InspectTrip":
    case "InspectComments":
    case "LoadedCommentCounts":
    case "LoadComments":
    case "LoadedComments":
    case "CommentChanged":
    case "CreatedCommentDraft":
    case "PostComment":
    case "PostedComment": {
      const changed = updateTrips(model.tripsState, message, {
        requestKey: requestKey(model),
      });
      const next = { ...model, tripsState: changed.model };
      if (changed.outMessage?._tag === "Reload") return loadPage(next);
      return {
        model: changed.outMessage
          ? {
              ...next,
              genieState: { ...next.genieState, genieSelection: null },
            }
          : next,
        commands: changed.commands ?? [],
      };
    }
    case "CloseSavedView":
    case "CloseDelete":
    case "SavedViewDialog":
    case "DeleteDialog":
    case "SavedViewsPicker":
    case "ClearView":
    case "NewSavedView":
    case "CreatedSavedView":
    case "EditSavedView":
    case "SavedViewChanged":
    case "SaveSavedView":
    case "SavedViewSaved":
    case "LoadSavedViews":
    case "LoadedSavedViews":
    case "PinSavedView":
    case "DeleteSavedView":
    case "ConfirmDelete":
    case "MutatedSavedView":
    case "RestoreView": {
      const changed = updateSavedViews(model.savedViewsState, message, {
        filters: filtersFromQuery(model.query) ?? {},
      });
      const next = {
        ...model,
        savedViewsState: changed.model,
        ...(changed.outMessage
          ? {
              filtersState: FilterDates.reset(
                model.filtersState,
                changed.outMessage.filters,
                model.metadata.data,
              ),
            }
          : {}),
      };
      return {
        model: next,
        commands: [
          ...(changed.commands ?? []),
          ...(changed.outMessage
            ? [
                AppCommands.Navigate({
                  href: href(model.path, queryFor(changed.outMessage.filters)),
                  external: false,
                }),
              ]
            : []),
        ],
      };
    }
    case "CloseGenie":
    case "GenieDialog":
    case "RestoredConversation":
    case "OpenGenie":
    case "ExpandGenie":
    case "ClearSelection":
    case "GenieDraft":
    case "SendQuestion":
    case "CreatedTurn":
    case "ChangedTurn":
    case "ResumeTurn":
    case "EditQuestion":
    case "NewConversation":
    case "Persisted":
    case "CopySql":
    case "CopiedSql": {
      const changed = updateGenie(model.genieState, message, {
        filters: filtersFromQuery(model.query),
        context: pageContext(model),
        enabled: !!model.status.data?.genie,
      });
      const next = { ...model, genieState: changed.model };
      return {
        model:
          changed.outMessage?._tag === "Opened"
            ? { ...next, mobileNavigation: false }
            : next,
        commands: [
          ...(changed.commands ?? []),
          ...(changed.outMessage
            ? [AppCommands.Focus({ selector: "#genie-composer" })]
            : []),
        ],
      };
    }
    case "GpsTabs":
    case "LoadedGps":
    case "GpsReady":
    case "GpsSelect": {
      if (model.path !== "/trip-map") return { model };
      const changed = updateGps(model.gpsState, message, {
        query: model.query,
      });
      return {
        model: {
          ...model,
          gpsState: changed.model,
          genieState: { ...model.genieState, genieSelection: null },
        },
        commands: changed.commands ?? [],
      };
    }
  }
}

export function update(
  model: Model,
  message: Message,
): Update.Return<Model, Message, ApiClient> {
  const result = updateApplication(model, message);
  let next = result.model;
  const commands = [...(result.commands ?? [])];
  // Release the child menu's resources when the mobile drawer is removed.
  if (next.mobile && !next.mobileNavigation && next.themeMenu.isOpen) {
    const closed = ThemeMenu.close(next.themeMenu);
    next = { ...next, themeMenu: closed.model };
    commands.push(
      ...(closed.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) => M.ThemeMenu({ message })),
      ),
    );
  }
  const navigation = syncDialog(
    next.navigationDialog,
    next.mobile && next.mobileNavigation,
  );
  const genie = presentGenie(
    next.genieState,
    next.mobile && next.path !== "/genie",
  );
  return {
    model: {
      ...next,
      navigationDialog: navigation.model,
      genieState: genie.model,
    },
    commands: [
      ...commands,
      ...(navigation.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) =>
          M.NavigationDialog({ message }),
        ),
      ),
      ...(genie.commands ?? []),
    ],
  };
}
