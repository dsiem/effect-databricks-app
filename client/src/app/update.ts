import { Dialog, Menu, Tooltip } from "@foldkit/ui";
import { Option } from "effect";
import { Command, Update } from "foldkit";
import type { Url } from "foldkit/url";
import * as Filters from "../features/filters/model";
import { filtersFromQuery, href, queryFor } from "../features/filters/query";
import { updateFilters } from "../features/filters/update";
import * as GenieCommands from "../features/genie/commands";
import * as Genie from "../features/genie/model";
import { updateGenie } from "../features/genie/update";
import * as PickupMap from "../features/map/model";
import { updateMap } from "../features/map/update";
import { MetricTabs } from "../features/overview/metric-tabs";
import * as Overview from "../features/overview/model";
import { updateOverview } from "../features/overview/update";
import * as SavedViews from "../features/saved-views/model";
import { updateSavedViews } from "../features/saved-views/update";
import * as Trips from "../features/trips/model";
import { updateTrips } from "../features/trips/update";
import type { ApiClient } from "../lib/api-client";
import { pending } from "../lib/request-state";
import * as AppCommands from "./commands";
import { Message as M, type Message } from "./message";
import { type Model, pageContext, requestKey } from "./model";
import { loadPage } from "./navigation";
import { ThemeMenu } from "./theme";
import { DialogId, initDialogs, initTooltip } from "./ui-state";

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
    dialogs: initDialogs(),
    metadata: pending,
    status: pending,
    user: null,
    filtersState: Filters.init(filters),
    overviewState: Overview.init(),
    tripsState: Trips.init(),
    savedViewsState: SavedViews.init(),
    genieState: Genie.init(),
    mapState: PickupMap.init(),
  };
  const loaded = loadPage(model);
  return {
    ...loaded,
    commands: [
      ...(loaded.commands ?? []),
      AppCommands.Boot(),
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
      return loadPage({
        ...model,
        path: message.path,
        query: message.query,
        mobileNavigation: false,
        tooltips: {},
        filtersState: {
          ...model.filtersState,
          filterDraft: {
            from: filters.from ?? "",
            to: filters.to ?? "",
            zip: filters.zip ?? "",
          },
        },
        tripsState: {
          ...model.tripsState,
          page: 1,
          sort: "newest",
          selectedTrip: null,
        },
        genieState: { ...model.genieState, genieSelection: null },
      });
    }
    case "Booted":
      return {
        model: {
          ...model,
          sidebar: message.sidebar,
          mobile: message.mobile,
          themePreference: message.themePreference,
          genieState: {
            ...model.genieState,
            turns: message.turns,
            persistenceError: message.persistenceError,
          },
        },
        commands: [
          AppCommands.SetTheme({
            preference: message.themePreference,
            persist: false,
          }),
          ...message.turns.flatMap<Command.Command<Message, never, ApiClient>>(
            (turn) =>
              turn.state === "waiting"
                ? [GenieCommands.PollQuestion({ turn })]
                : turn.state === "retrieving"
                  ? [GenieCommands.RetrieveQuestion({ turn })]
                  : [],
          ),
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
    case "CloseOverlay": {
      if (model.savedViewsState.editor)
        return model.savedViewsState.editor.saving
          ? { model }
          : {
              model: {
                ...model,
                savedViewsState: { ...model.savedViewsState, editor: null },
              },
            };
      if (model.savedViewsState.deleting)
        return model.savedViewsState.noteBusy
          ? { model }
          : {
              model: {
                ...model,
                savedViewsState: { ...model.savedViewsState, deleting: null },
              },
            };
      if (model.tripsState.selectedTrip)
        return {
          model: {
            ...model,
            tripsState: { ...model.tripsState, selectedTrip: null },
          },
        };
      if (model.savedViewsState.savedViews)
        return {
          model: {
            ...model,
            savedViewsState: { ...model.savedViewsState, savedViews: false },
          },
        };
      if (model.mobileNavigation)
        return { model: { ...model, mobileNavigation: false } };
      return {
        model: {
          ...model,
          genieState: { ...model.genieState, genieOpen: false },
        },
      };
    }
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
    case "MetricTabs":
      return Update.foldChild({
        update: MetricTabs.update,
        read: (model: Model) => Option.some(model.overviewState.metricTabs),
        write: (model, metricTabs) => ({
          ...model,
          overviewState: { ...model.overviewState, metricTabs },
        }),
        toParentMessage: (message) => M.MetricTabs({ message }),
        foldOutMessage: (out) => (model) => ({
          model: {
            ...model,
            overviewState: { ...model.overviewState, series: out.value },
            genieState: { ...model.genieState, genieSelection: null },
          },
        }),
      })(model, message.message);
    case "Dialog": {
      if (
        message.message._tag === "RequestedClose" &&
        ((message.id === "note" && model.savedViewsState.editor?.saving) ||
          (message.id === "delete" && model.savedViewsState.noteBusy))
      )
        return { model };
      return Update.foldChild({
        update: Dialog.update,
        read: (model: Model) => Option.some(model.dialogs[message.id]),
        write: (model, child) => ({
          ...model,
          dialogs: { ...model.dialogs, [message.id]: child },
        }),
        toParentMessage: (child) =>
          M.Dialog({ id: message.id, message: child }),
        foldOutMessage: (out) => (model) => ({
          model:
            out._tag === "Closed" ? dismissDialog(model, message.id) : model,
        }),
      })(model, message.message);
    }
    case "LoadedMetadata":
      return {
        model: {
          ...model,
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
    case "FilterChanged":
    case "ApplyFilters":
    case "ResetFilters":
    case "PickZip": {
      const changed = updateFilters(model.filtersState, message, {
        query: model.query,
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
    case "SetPage":
    case "SortTrips":
    case "ExportTrips":
    case "LoadedTrips":
    case "InspectTrip":
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
    case "OpenSavedViews":
    case "NewNote":
    case "CreatedNote":
    case "EditNote":
    case "NoteChanged":
    case "SaveNote":
    case "SavedNote":
    case "LoadNotes":
    case "LoadedNotes":
    case "PinNote":
    case "DeleteNote":
    case "ConfirmDelete":
    case "MutatedNote":
    case "RestoreView": {
      const changed = updateSavedViews(model.savedViewsState, message, {
        filters: filtersFromQuery(model.query) ?? {},
        query: model.query,
      });
      const next = { ...model, savedViewsState: changed.model };
      return {
        model: next,
        commands: changed.outMessage
          ? [
              AppCommands.Navigate({
                href: href(model.path, queryFor(changed.outMessage.filters)),
                external: false,
              }),
            ]
          : (changed.commands ?? []),
      };
    }
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
    case "MapReady": {
      const changed = updateMap(model.mapState, message, {
        query: model.query,
      });
      const next = { ...model, mapState: changed.model };
      return { model: next, commands: changed.commands ?? [] };
    }
  }
}

function dismissDialog(model: Model, id: DialogId): Model {
  switch (id) {
    case "note":
      return {
        ...model,
        savedViewsState: { ...model.savedViewsState, editor: null },
      };
    case "delete":
      return {
        ...model,
        savedViewsState: { ...model.savedViewsState, deleting: null },
      };
    case "trip":
      return {
        ...model,
        tripsState: { ...model.tripsState, selectedTrip: null },
      };
    case "views":
      return {
        ...model,
        savedViewsState: { ...model.savedViewsState, savedViews: false },
      };
    case "navigation":
      return { ...model, mobileNavigation: false };
    case "genie":
      return {
        ...model,
        genieState: { ...model.genieState, genieOpen: false },
      };
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
  // Domain state controls visibility; Foldkit owns each dialog's lifecycle.
  const visibility = {
    views: next.savedViewsState.savedViews,
    note: next.savedViewsState.editor !== null,
    delete: next.savedViewsState.deleting !== null,
    trip: next.tripsState.selectedTrip !== null,
    navigation: next.mobile && next.mobileNavigation,
    genie: next.mobile && next.genieState.genieOpen && next.path !== "/genie",
  };
  for (const id of DialogId.literals) {
    const child = next.dialogs[id];
    if (visibility[id] === child.isOpen) continue;
    const changed = visibility[id] ? Dialog.open(child) : Dialog.close(child);
    next = { ...next, dialogs: { ...next.dialogs, [id]: changed.model } };
    commands.push(
      ...(changed.commands ?? []).map((command) =>
        Command.mapMessage(command, (message) => M.Dialog({ id, message })),
      ),
    );
  }
  return { model: next, commands };
}
