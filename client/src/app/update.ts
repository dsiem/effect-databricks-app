import { Dialog, Tooltip } from "@foldkit/ui";
import { Option } from "effect";
import { Command, Update } from "foldkit";
import type { Url } from "foldkit/url";
import { updateFilters } from "../features/filters/update";
import * as GenieCommands from "../features/genie/commands";
import { updateGenie } from "../features/genie/update";
import { updateMap } from "../features/map/update";
import { MetricTabs } from "../features/overview/metric-tabs";
import { updateOverview } from "../features/overview/update";
import { updateSavedViews } from "../features/saved-views/update";
import { updateTrips } from "../features/trips/update";
import type { ApiClient } from "../lib/api-client";
import * as AppCommands from "./commands";
import { Message as M, type Message } from "./message";
import { filtersFromQuery, type Model } from "./model";
import { loadPage } from "./navigation";
import { empty, pending } from "./request-state";
import {
  DialogId,
  initCalendars,
  initDialogs,
  initMetricTabs,
  initTooltip,
} from "./ui-state";

export function init(url: Url): Update.Return<Model, Message, ApiClient> {
  const query = Option.getOrElse(url.search, () => "").replace(/^\?/, "");
  const filters = filtersFromQuery(query) ?? {};
  const model: Model = {
    path: url.pathname,
    query,
    filterDraft: {
      from: filters.from ?? "",
      to: filters.to ?? "",
      zip: filters.zip ?? "",
    },
    sidebar: true,
    mobile: false,
    mobileNavigation: false,
    tooltips: {},
    metricTabs: initMetricTabs(),
    dialogs: initDialogs(),
    calendars: initCalendars("2016-01-01"),
    metadata: pending,
    status: pending,
    user: null,
    overview: empty,
    trips: empty,
    page: 1,
    sort: "newest",
    series: "trips",
    notes: empty,
    notePages: 1,
    savedViews: false,
    editor: null,
    deleting: null,
    noteBusy: false,
    noteError: "",
    saved: null,
    selectedTrip: null,
    comments: empty,
    commentDrafts: {},
    posting: null,
    postError: "",
    posted: "",
    calendar: false,
    calendarMonth: "",
    calendarEnd: false,
    genieOpen: false,
    genieExpanded: false,
    genieDraft: "",
    genieSelection: null,
    turns: [],
    persistenceError: "",
    clipboard: "",
    mappedTrips: null,
    mapError: "",
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
        filterDraft: {
          from: filters.from ?? "",
          to: filters.to ?? "",
          zip: filters.zip ?? "",
        },
        page: 1,
        sort: "newest",
        selectedTrip: null,
        mobileNavigation: false,
        calendar: false,
        genieSelection: null,
        tooltips: {},
      });
    }
    case "Booted":
      return {
        model: {
          ...model,
          turns: message.turns,
          persistenceError: message.persistenceError,
          sidebar: message.sidebar,
          mobile: message.mobile,
          calendars: [
            { ...model.calendars[0], today: message.today },
            { ...model.calendars[1], today: message.today },
          ],
        },
        commands: message.turns.flatMap<
          Command.Command<Message, never, ApiClient>
        >((turn) =>
          turn.state === "waiting"
            ? [GenieCommands.PollQuestion({ turn })]
            : turn.state === "retrieving"
              ? [GenieCommands.RetrieveQuestion({ turn })]
              : [],
        ),
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
      if (model.editor)
        return model.editor.saving
          ? { model }
          : { model: { ...model, editor: null } };
      if (model.deleting)
        return model.noteBusy
          ? { model }
          : { model: { ...model, deleting: null } };
      if (model.selectedTrip)
        return { model: { ...model, selectedTrip: null } };
      if (model.calendar) return { model: { ...model, calendar: false } };
      if (model.savedViews) return { model: { ...model, savedViews: false } };
      if (model.mobileNavigation)
        return { model: { ...model, mobileNavigation: false } };
      return { model: { ...model, genieOpen: false } };
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
        read: (model: Model) => Option.some(model.metricTabs),
        write: (model, metricTabs) => ({ ...model, metricTabs }),
        toParentMessage: (message) => M.MetricTabs({ message }),
        foldOutMessage: (out) => (model) => ({
          model: { ...model, series: out.value, genieSelection: null },
        }),
      })(model, message.message);
    case "Dialog": {
      if (
        message.message._tag === "RequestedClose" &&
        ((message.id === "note" && model.editor?.saving) ||
          (message.id === "delete" && model.noteBusy))
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
        commands: model.genieOpen
          ? [AppCommands.Focus({ selector: "#genie-composer" })]
          : [],
      };
    case "LoadedUser":
      return { model: { ...model, user: message.user } };
    case "LoadPage":
      return loadPage(model);
    case "Calendar":
    case "FilterChanged":
    case "ApplyFilters":
    case "ResetFilters":
    case "PickZip":
    case "OpenCalendar":
    case "CalendarMonth":
    case "CalendarDay":
    case "ClearDates":
      return updateFilters(model, message);
    case "LoadedOverview":
      return updateOverview(model, message);
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
    case "PostedComment":
      return updateTrips(model, message);
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
    case "RestoreView":
      return updateSavedViews(model, message);
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
    case "CopiedSql":
      return updateGenie(model, message);
    case "MapReady":
      return updateMap(model, message);
  }
}

function dismissDialog(model: Model, id: DialogId): Model {
  switch (id) {
    case "note":
      return { ...model, editor: null };
    case "delete":
      return { ...model, deleting: null };
    case "trip":
      return { ...model, selectedTrip: null };
    case "calendar":
      return { ...model, calendar: false };
    case "views":
      return { ...model, savedViews: false };
    case "navigation":
      return { ...model, mobileNavigation: false };
    case "genie":
      return { ...model, genieOpen: false };
  }
}

export function update(
  model: Model,
  message: Message,
): Update.Return<Model, Message, ApiClient> {
  const result = updateApplication(model, message);
  let next = result.model;
  const commands = [...(result.commands ?? [])];
  // Domain state controls visibility; Foldkit owns each dialog's lifecycle.
  const visibility = {
    views: next.savedViews,
    note: next.editor !== null,
    delete: next.deleting !== null,
    trip: next.selectedTrip !== null,
    calendar: next.calendar,
    navigation: next.mobile && next.mobileNavigation,
    genie: next.mobile && next.genieOpen && next.path !== "/genie",
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
