import { Calendar, Dialog, Tooltip } from "@foldkit/ui";
import { Option } from "effect";
import { Command, Update } from "foldkit";
import * as CalendarDate from "foldkit/calendar";
import type { Url } from "foldkit/url";
import * as C from "./commands";
import { MetricTabs } from "./components";
import type { ApiClient } from "./lib/api-client";
import { Message as M, type Message } from "./message";
import {
  busy,
  filtersFromQuery,
  href,
  type Model,
  pageContext,
  queryFor,
  requestKey,
  turnBase,
} from "./model";
import {
  DialogId,
  initCalendars,
  initDialogs,
  initMetricTabs,
  initTooltip,
  isoDate,
  parseDate,
} from "./ui-state";

const empty = { data: null, error: "", loading: false };
const pending = { ...empty, loading: true };
const loadNotes = (
  model: Model,
  more = false,
): Update.Return<Model, Message, ApiClient> => ({
  model: { ...model, notes: { ...model.notes, loading: true, error: "" } },
  commands: [
    C.LoadNotes({
      cursor: more ? (model.notes.data?.nextCursor ?? null) : null,
      pages: more ? 1 : model.notePages,
      more,
    }),
  ],
});
export function loadPage(
  model: Model,
): Update.Return<Model, Message, ApiClient> {
  const filters = filtersFromQuery(model.query);
  if (!filters) return { model };
  if (model.path === "/" || model.path === "/map")
    return {
      model: {
        ...model,
        overview: pending,
        mappedTrips: null,
        mapError: "",
        genieSelection: null,
      },
      commands: [C.LoadOverview({ key: requestKey(model), filters })],
    };
  if (model.path === "/trips")
    return {
      model: { ...model, trips: pending, genieSelection: null },
      commands: [
        C.LoadTrips({
          key: requestKey(model),
          filters,
          page: model.page,
          sort: model.sort,
        }),
      ],
    };
  return { model };
}
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
      C.Boot(),
      C.LoadMetadata(),
      C.LoadStatus(),
      C.LoadUser(),
    ],
  };
}
const navigate = (model: Model, path: string, query: string) => ({
  model,
  commands: [C.Navigate({ href: href(path, query), external: false })],
});
const comments = (
  model: Model,
  more = false,
): Update.Return<Model, Message, ApiClient> =>
  model.selectedTrip
    ? {
        model: {
          ...model,
          comments: { ...model.comments, loading: true, error: "" },
        },
        commands: [
          C.LoadComments({
            trip: model.selectedTrip,
            cursor: more ? (model.comments.data?.nextCursor ?? null) : null,
            more,
          }),
        ],
      }
    : { model };
function updateApplication(
  model: Model,
  message: Message,
): Update.Return<Model, Message, ApiClient> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "Navigate":
      return { model, commands: [C.Navigate(message)] };
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
            ? [C.PollQuestion({ turn })]
            : turn.state === "retrieving"
              ? [C.RetrieveQuestion({ turn })]
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
            commands: [C.PersistSidebar({ open: !model.sidebar })],
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
    case "Calendar":
      return Update.foldChild({
        update: Calendar.update,
        read: (model: Model) => Option.some(model.calendars[message.index]),
        write: (model, child) => ({
          ...model,
          calendars:
            message.index === 0
              ? ([child, model.calendars[1]] as const)
              : ([model.calendars[0], child] as const),
        }),
        toParentMessage: (child) =>
          M.Calendar({ index: message.index, message: child }),
        foldOutMessage: (out) => (model) =>
          out._tag === "SelectedDate"
            ? updateApplication(
                model,
                M.CalendarDay({ day: isoDate(out.date) }),
              )
            : updateApplication(
                model,
                M.CalendarMonth({
                  month: `${out.year}-${String(out.month).padStart(2, "0")}`,
                  index: message.index,
                }),
              ),
      })(model, message.message);
    case "FilterChanged":
      return {
        model: {
          ...model,
          filterDraft: { ...model.filterDraft, [message.field]: message.value },
        },
      };
    case "ApplyFilters":
      return navigate(model, model.path, queryFor(model.filterDraft));
    case "ResetFilters":
      return navigate(model, model.path, "");
    case "PickZip":
      return navigate(
        model,
        model.path,
        queryFor({
          ...(filtersFromQuery(model.query) ?? {}),
          zip: message.zip,
        }),
      );
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
          ? [C.Focus({ selector: "#genie-composer" })]
          : [],
      };
    case "LoadedUser":
      return { model: { ...model, user: message.user } };
    case "LoadPage":
      return loadPage(model);
    case "LoadedOverview":
      return message.key !== requestKey(model)
        ? { model }
        : {
            model: {
              ...model,
              overview: {
                data: message.data,
                error: message.error,
                loading: false,
              },
              genieSelection: null,
            },
          };
    case "LoadedTrips":
      return message.key !== requestKey(model)
        ? { model }
        : {
            model: {
              ...model,
              trips: {
                data: message.data,
                error: message.error,
                loading: false,
              },
              genieSelection: null,
            },
          };
    case "SetPage":
      return loadPage({ ...model, page: message.page });
    case "SortTrips":
      return loadPage({
        ...model,
        page: 1,
        sort: message.sort,
      });
    case "ExportTrips":
      return {
        model,
        commands: model.trips.data
          ? [C.ExportTrips({ rows: model.trips.data.rows, page: model.page })]
          : [],
      };
    case "OpenCalendar":
      return {
        model: {
          ...model,
          calendar: true,
          calendarEnd: false,
          calendarMonth: (
            model.filterDraft.from ||
            model.filterDraft.to ||
            model.metadata.data?.from ||
            "2016-01-01"
          ).slice(0, 7),
          calendars: initCalendars(
            model.filterDraft.from ||
              model.filterDraft.to ||
              model.metadata.data?.from ||
              "2016-01-01",
            model.metadata.data?.from,
            model.metadata.data?.to,
            model.calendars[0].today,
          ),
        },
      };
    case "CalendarMonth": {
      const value = CalendarDate.subtractMonths(
        parseDate(`${message.month}-01`),
        message.index ?? 0,
      );
      return {
        model: {
          ...model,
          calendarMonth: isoDate(value).slice(0, 7),
          calendars: [
            message.index === 0
              ? model.calendars[0]
              : Calendar.focusDate(model.calendars[0], value),
            message.index === 1
              ? model.calendars[1]
              : Calendar.focusDate(
                  model.calendars[1],
                  CalendarDate.addMonths(value, 1),
                ),
          ],
        },
      };
    }
    case "CalendarDay": {
      const dates = [
        model.calendarEnd ? model.filterDraft.from || message.day : message.day,
        message.day,
      ].sort();
      return {
        model: {
          ...model,
          calendarEnd: !model.calendarEnd,
          filterDraft: {
            ...model.filterDraft,
            from: dates[0] ?? message.day,
            to: dates[1] ?? message.day,
          },
        },
      };
    }
    case "ClearDates":
      return {
        model: {
          ...model,
          calendarEnd: false,
          filterDraft: { ...model.filterDraft, from: "", to: "" },
        },
      };
    case "OpenSavedViews":
      return loadNotes({ ...model, savedViews: true });
    case "NewNote":
      return { model, commands: [C.NewNote({})] };
    case "CreatedNote":
      return {
        model: {
          ...model,
          editor: {
            draft: {
              id: message.id,
              title: "",
              body: "",
              filters: filtersFromQuery(model.query) ?? {},
              version: null,
            },
            saving: false,
            error: "",
          },
        },
      };
    case "EditNote": {
      const { id, title, body, filters, version } = message.note;
      return {
        model: {
          ...model,
          editor: {
            draft: { id, title, body, filters, version },
            saving: false,
            error: "",
          },
        },
      };
    }
    case "NoteChanged":
      return {
        model: {
          ...model,
          editor: model.editor
            ? {
                ...model.editor,
                draft: {
                  ...model.editor.draft,
                  [message.field]: message.value,
                },
              }
            : null,
        },
      };
    case "SaveNote":
      return !model.editor ||
        model.editor.saving ||
        !model.editor.draft.title.trim()
        ? { model }
        : {
            model: {
              ...model,
              editor: { ...model.editor, saving: true, error: "" },
            },
            commands: [C.SaveNote({ draft: model.editor.draft })],
          };
    case "SavedNote": {
      const next = {
        ...model,
        editor: message.note
          ? null
          : model.editor
            ? { ...model.editor, saving: false, error: message.error }
            : null,
        saved: message.note
          ? { title: message.note.title, query: model.query }
          : model.saved,
      };
      return loadNotes(next);
    }
    case "LoadNotes":
      return model.notes.loading ? { model } : loadNotes(model, message.more);
    case "LoadedNotes":
      return {
        model: {
          ...model,
          notePages: message.data
            ? message.more
              ? model.notePages + 1
              : message.pages
            : model.notePages,
          notes: {
            loading: false,
            error: message.error,
            data: message.data
              ? {
                  ...message.data,
                  rows: message.more
                    ? [...(model.notes.data?.rows ?? []), ...message.data.rows]
                    : message.data.rows,
                }
              : model.notes.data,
          },
        },
      };
    case "PinNote":
      return model.noteBusy
        ? { model }
        : {
            model: { ...model, noteBusy: true, noteError: "" },
            commands: [C.PinNote({ note: message.note })],
          };
    case "DeleteNote":
      return { model: { ...model, deleting: message.note, noteError: "" } };
    case "ConfirmDelete":
      return !model.deleting || model.noteBusy
        ? { model }
        : {
            model: { ...model, noteBusy: true },
            commands: [C.DeleteNote({ note: model.deleting })],
          };
    case "MutatedNote":
      return loadNotes({
        ...model,
        noteBusy: false,
        noteError: message.error,
        deleting: message.removed && !message.error ? null : model.deleting,
      });
    case "RestoreView":
      return {
        model: { ...model, savedViews: false },
        commands: [
          C.Navigate({
            href: href(model.path, queryFor(message.filters)),
            external: false,
          }),
        ],
      };
    case "InspectTrip":
      return comments({
        ...model,
        selectedTrip: message.trip,
        comments: empty,
        postError: "",
        posted: "",
      });
    case "LoadComments":
      return model.comments.loading ? { model } : comments(model, message.more);
    case "LoadedComments":
      return message.tripId !== model.selectedTrip?.trip_id
        ? { model }
        : {
            model: {
              ...model,
              comments: {
                loading: false,
                error: message.error,
                data: message.data
                  ? {
                      ...message.data,
                      rows: message.more
                        ? [
                            ...(model.comments.data?.rows ?? []),
                            ...message.data.rows,
                          ]
                        : message.data.rows,
                    }
                  : model.comments.data,
              },
            },
          };
    case "CommentChanged": {
      const id = model.selectedTrip?.trip_id;
      if (!id) return { model };
      const draft = model.commentDrafts[id];
      if (!draft || (draft.id && model.posting?.id === draft.id))
        return {
          model: {
            ...model,
            commentDrafts: {
              ...model.commentDrafts,
              [id]: { id: "", body: message.body },
            },
          },
          commands: [C.CommentDraft({ tripId: id, body: message.body })],
        };
      return {
        model: {
          ...model,
          commentDrafts: {
            ...model.commentDrafts,
            [id]: { ...draft, body: message.body },
          },
          postError: "",
          posted: "",
        },
      };
    }
    case "CreatedCommentDraft": {
      const existing = model.commentDrafts[message.tripId];
      return {
        model: {
          ...model,
          commentDrafts: {
            ...model.commentDrafts,
            [message.tripId]: {
              id: message.draft.id,
              body: existing?.body ?? message.draft.body,
            },
          },
        },
      };
    }
    case "PostComment": {
      const trip = model.selectedTrip;
      const draft = trip && model.commentDrafts[trip.trip_id];
      if (!trip || !draft?.id || !draft.body.trim() || model.posting)
        return { model };
      const input = { ...draft, trip };
      return {
        model: { ...model, posting: input, postError: "", posted: "" },
        commands: [C.PostComment({ input })],
      };
    }
    case "PostedComment": {
      const key = message.input.trip.trip_id;
      const drafts = { ...model.commentDrafts };
      if (
        !message.error &&
        drafts[key]?.id === message.input.id &&
        drafts[key]?.body === message.input.body
      )
        delete drafts[key];
      const next = {
        ...model,
        posting: null,
        commentDrafts: drafts,
        posted: message.error ? "" : key,
        postError: model.selectedTrip?.trip_id === key ? message.error : "",
      };
      return message.error || model.selectedTrip?.trip_id !== key
        ? { model: next }
        : comments(next);
    }
    case "OpenGenie":
      return {
        model: {
          ...model,
          mobileNavigation: false,
          genieOpen: true,
          genieSelection: message.context ?? model.genieSelection,
          genieDraft: message.question ?? model.genieDraft,
        },
        commands: [C.Focus({ selector: "#genie-composer" })],
      };
    case "ExpandGenie":
      return { model: { ...model, genieExpanded: !model.genieExpanded } };
    case "ClearSelection":
      return { model: { ...model, genieSelection: null } };
    case "GenieDraft":
      return { model: { ...model, genieDraft: message.value } };
    case "SendQuestion":
      return busy(model) ||
        !message.question.trim() ||
        !filtersFromQuery(model.query) ||
        !model.status.data?.genie
        ? { model }
        : {
            model,
            commands: [C.CreateTurn({ question: message.question.trim() })],
          };
    case "CreatedTurn": {
      if (busy(model)) return { model };
      const turn = {
        id: message.id,
        question: message.question,
        filters: filtersFromQuery(model.query) ?? {},
        context: model.genieSelection ?? pageContext(model),
        state: "submitting" as const,
      };
      const previous = model.turns
        .toReversed()
        .find((turn) => "operation" in turn || turn.state === "complete");
      const conversationId =
        previous && "operation" in previous
          ? previous.operation.conversationId
          : previous?.state === "complete"
            ? previous.reply.conversationId
            : null;
      const turns = [...model.turns, turn];
      return {
        model: { ...model, turns, genieDraft: "" },
        commands: [
          C.PersistTurns({ turns }),
          C.SubmitQuestion({ turn, conversationId }),
        ],
      };
    }
    case "ChangedTurn": {
      const old = model.turns.find((turn) => turn.id === message.turn.id);
      if (!old) return { model };
      const turns = model.turns.map((turn) =>
        turn.id === message.turn.id ? message.turn : turn,
      );
      const commands: Command.Command<Message, never, ApiClient>[] = [
        C.PersistTurns({ turns }),
      ];
      if (message.turn.state === "waiting" && old.state !== "waiting")
        commands.push(C.PollQuestion({ turn: message.turn }));
      if (message.turn.state === "retrieving" && old.state !== "retrieving")
        commands.push(C.RetrieveQuestion({ turn: message.turn }));
      return { model: { ...model, turns }, commands };
    }
    case "ResumeTurn": {
      if (busy(model)) return { model };
      const turn = model.turns.find((turn) => turn.id === message.id);
      return turn?.state === "paused"
        ? update(
            model,
            M.ChangedTurn({
              turn: {
                ...turnBase(turn),
                operation: turn.operation,
                state: turn.stage,
              },
            }),
          )
        : { model };
    }
    case "EditQuestion":
      return {
        model: { ...model, genieDraft: message.question },
        commands: [C.Focus({ selector: "#genie-composer" })],
      };
    case "NewConversation":
      return busy(model)
        ? { model }
        : {
            model: { ...model, turns: [] },
            commands: [C.PersistTurns({ turns: [] })],
          };
    case "Persisted":
      return { model: { ...model, persistenceError: message.error } };
    case "CopySql":
      return { model, commands: [C.CopySql({ sql: message.sql })] };
    case "CopiedSql":
      return { model: { ...model, clipboard: message.text } };
    case "MapReady":
      return model.query !== message.query
        ? { model }
        : {
            model: {
              ...model,
              mappedTrips: message.mapped,
              mapError: message.error,
            },
          };
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
