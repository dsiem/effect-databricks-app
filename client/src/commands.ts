import { Effect, Schema, type Scope } from "effect";
import { Command, Navigation } from "foldkit";
import * as CalendarDate from "foldkit/calendar";
import { ApiError } from "../../src/api";
import * as D from "../../src/domain";
import { request } from "./lib/api-client";
import { Message as M } from "./message";
import { History, Turn, turnBase } from "./model";

const failure = (error: unknown) =>
  Schema.is(ApiError)(error)
    ? error.error.message
    : "Unable to complete the request. Check your connection and retry.";
// The shared HTTP contract is the only network error boundary.
const result = <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>) =>
  effect.pipe(
    Effect.scoped,
    Effect.match({
      onSuccess: (data) => ({ data, error: "" }),
      onFailure: (error) => ({ data: null, error: failure(error) }),
    }),
  );
const done = (effect: Effect.Effect<unknown>) =>
  effect.pipe(Effect.as(M.Idle()));
export const Navigate = Command.define("Navigate", {
  args: { href: Schema.String, external: Schema.Boolean },
  messages: [M.Idle],
  execute: ({ href, external }) =>
    done(external ? Navigation.load(href) : Navigation.pushUrl(href)),
});
export const Boot = Command.define("RestoreWorkspace", {
  messages: [M.Booted],
  execute: Effect.sync(() => {
    let turns: typeof History.Type = [];
    let persistenceError = "";
    try {
      const stored = sessionStorage.getItem("metrocab.genie.v1");
      if (stored)
        turns = Schema.decodeUnknownSync(History)(JSON.parse(stored)).map(
          (turn) =>
            turn.state === "submitting"
              ? {
                  ...turnBase(turn),
                  state: "submission-unknown" as const,
                  error:
                    "The submission response was lost. The question may have been accepted. Check Genie before submitting it again.",
                }
              : turn,
        );
    } catch {
      persistenceError =
        "Conversation recovery is unavailable in this browser session.";
    }
    return M.Booted({
      turns,
      persistenceError,
      today: CalendarDate.fromDateLocal(new Date()),
      sidebar: !document.cookie.split("; ").includes("sidebar_state=false"),
      mobile: matchMedia("(max-width: 767px)").matches,
    });
  }),
});
export const PersistSidebar = Command.define("PersistSidebar", {
  args: { open: Schema.Boolean },
  messages: [M.Idle],
  execute: ({ open }) =>
    done(
      Effect.sync(() => {
        // biome-ignore lint/suspicious/noDocumentCookie: persist the existing boolean sidebar preference across reloads.
        document.cookie = `sidebar_state=${open}; path=/; max-age=604800; SameSite=Lax`;
      }),
    ),
});
export const Focus = Command.define("Focus", {
  args: { selector: Schema.String },
  messages: [M.Idle],
  execute: ({ selector }) =>
    done(
      Effect.sleep("20 millis").pipe(
        Effect.andThen(
          Effect.sync(() =>
            document.querySelector<HTMLElement>(selector)?.focus(),
          ),
        ),
      ),
    ),
});
export const LoadMetadata = Command.define("LoadMetadata", {
  messages: [M.LoadedMetadata],
  execute: result(request((client) => client.metadata())).pipe(
    Effect.map(M.LoadedMetadata),
  ),
});
export const LoadStatus = Command.define("LoadStatus", {
  messages: [M.LoadedStatus],
  execute: result(request((client) => client.status())).pipe(
    Effect.map(M.LoadedStatus),
  ),
});
export const LoadUser = Command.define("LoadUser", {
  messages: [M.LoadedUser],
  execute: result(request((client) => client.currentUser())).pipe(
    Effect.map(({ data }) => M.LoadedUser({ user: data })),
  ),
});
export const LoadOverview = Command.define("LoadOverview", {
  args: { key: Schema.String, filters: D.Filters },
  messages: [M.LoadedOverview],
  execute: ({ key, filters }) =>
    result(request((client) => client.overview({ query: filters }))).pipe(
      Effect.map((value) => M.LoadedOverview({ key, ...value })),
    ),
});
export const LoadTrips = Command.define("LoadTrips", {
  args: {
    key: Schema.String,
    filters: D.Filters,
    page: Schema.Number,
    sort: Schema.Literals(["newest", "fare", "distance"]),
  },
  messages: [M.LoadedTrips],
  execute: ({ key, filters, page, sort }) =>
    result(
      request((client) => client.trips({ query: { ...filters, page, sort } })),
    ).pipe(Effect.map((value) => M.LoadedTrips({ key, ...value }))),
});
export const NewNote = Command.define("CreateNoteDraft", {
  args: {},
  messages: [M.CreatedNote],
  execute: () => Effect.sync(() => M.CreatedNote({ id: crypto.randomUUID() })),
});
export const SaveNote = Command.define("SaveNote", {
  args: { draft: D.NoteInput },
  messages: [M.SavedNote],
  execute: ({ draft }) =>
    result(
      request((client) =>
        client.saveNote({ payload: { ...draft, title: draft.title.trim() } }),
      ),
    ).pipe(Effect.map(({ data, error }) => M.SavedNote({ note: data, error }))),
});
export const LoadNotes = Command.define("LoadNotes", {
  args: {
    cursor: Schema.NullOr(D.NoteCursor),
    pages: Schema.Number,
    more: Schema.Boolean,
  },
  messages: [M.LoadedNotes],
  execute: ({ cursor, pages, more }) =>
    result(
      Effect.gen(function* () {
        let next = cursor;
        const rows: D.Note[] = [];
        for (let page = 0; page < pages; page++) {
          const response = yield* request((client) =>
            client.notes({
              query: next ? { cursor: next } : {},
            }),
          );
          rows.push(...response.rows);
          next = response.nextCursor;
          if (!next) break;
        }
        return { rows, nextCursor: next };
      }),
    ).pipe(Effect.map((value) => M.LoadedNotes({ ...value, more, pages }))),
});
export const PinNote = Command.define("PinNote", {
  args: { note: D.Note },
  messages: [M.MutatedNote],
  execute: ({ note }) =>
    result(
      request((client) =>
        client.pinNote({
          params: { id: note.id },
          payload: { pinned: !note.pinned, version: note.version },
        }),
      ),
    ).pipe(Effect.map(({ error }) => M.MutatedNote({ error, removed: false }))),
});
export const DeleteNote = Command.define("DeleteNote", {
  args: { note: D.Note },
  messages: [M.MutatedNote],
  execute: ({ note }) =>
    result(
      request((client) =>
        client.removeNote({
          params: { id: note.id },
          query: { version: note.version },
        }),
      ),
    ).pipe(Effect.map(({ error }) => M.MutatedNote({ error, removed: true }))),
});
export const LoadComments = Command.define("LoadComments", {
  args: {
    trip: D.Trip,
    cursor: Schema.NullOr(D.TripCommentCursor),
    more: Schema.Boolean,
  },
  messages: [M.LoadedComments],
  execute: ({ trip, cursor, more }) =>
    result(
      request((client) =>
        client.tripComments({
          query: { trip, ...(cursor ? { cursor } : {}) },
        }),
      ),
    ).pipe(
      Effect.map((value) =>
        M.LoadedComments({ tripId: trip.trip_id, ...value, more }),
      ),
    ),
});
export const CommentDraft = Command.define("CreateCommentDraft", {
  args: { tripId: Schema.String, body: Schema.String },
  messages: [M.CreatedCommentDraft],
  execute: ({ tripId, body }) =>
    Effect.sync(() =>
      M.CreatedCommentDraft({
        tripId,
        draft: { id: crypto.randomUUID(), body },
      }),
    ),
});
export const PostComment = Command.define("PostComment", {
  args: { input: D.TripCommentInput },
  messages: [M.PostedComment],
  execute: ({ input }) =>
    result(request((client) => client.addTripComment({ payload: input }))).pipe(
      Effect.map(({ error }) => M.PostedComment({ input, error })),
    ),
});
export const CreateTurn = Command.define("CreateQuestion", {
  args: { question: Schema.String },
  messages: [M.CreatedTurn],
  execute: ({ question }) =>
    Effect.sync(() => M.CreatedTurn({ id: crypto.randomUUID(), question })),
});
export const SubmitQuestion = Command.define("SubmitQuestion", {
  args: { turn: Turn, conversationId: Schema.NullOr(Schema.String) },
  messages: [M.ChangedTurn],
  execute: ({ turn, conversationId }) =>
    request((client) =>
      client.submitGenie({
        payload: {
          content: turn.question,
          ...(turn.filters ? { filters: turn.filters } : {}),
          ...(turn.context ? { context: turn.context } : {}),
          ...(conversationId ? { conversationId } : {}),
        },
      }),
    ).pipe(
      Effect.scoped,
      Effect.match({
        onSuccess: (operation) =>
          M.ChangedTurn({
            turn: { ...turnBase(turn), state: "waiting", operation },
          }),
        onFailure: (error) => {
          const rejected =
            Schema.is(ApiError)(error) &&
            (error.error.code === "invalid_request" ||
              ("upstreamStatus" in error.error &&
                [400, 401, 403, 404, 409, 422, 429].includes(
                  error.error.upstreamStatus ?? 0,
                )));
          return M.ChangedTurn({
            turn: {
              ...turnBase(turn),
              state: rejected ? "submission-rejected" : "submission-unknown",
              error: rejected
                ? `The question was rejected. ${failure(error)}`
                : `${failure(error)} The question may have been accepted. Check Genie before submitting it again.`,
            },
          });
        },
      }),
    ),
});
export const PollQuestion = Command.define("PollQuestion", {
  args: { turn: Turn },
  messages: [M.ChangedTurn],
  execute: ({ turn }) => {
    if (!("operation" in turn)) return Effect.succeed(M.ChangedTurn({ turn }));
    const operation = turn.operation;
    return Effect.gen(function* () {
      const deadline = Date.now() + 180_000;
      while (true) {
        const progress = yield* request((client) =>
          client.pollGenie({ params: operation }),
        );
        if (progress.state === "failed")
          return M.ChangedTurn({
            turn: {
              ...turnBase(turn),
              operation,
              state: "failed",
              error: `Genie could not complete this question (${progress.status}).`,
            },
          });
        if (progress.state === "completed")
          return M.ChangedTurn({
            turn: { ...turnBase(turn), operation, state: "retrieving" },
          });
        if (Date.now() >= deadline)
          return M.ChangedTurn({
            turn: {
              ...turnBase(turn),
              operation,
              state: "paused",
              stage: "waiting",
              error:
                "Genie is taking longer than expected. Resume waiting for this answer.",
            },
          });
        yield* Effect.sleep("1 second");
      }
    }).pipe(
      Effect.scoped,
      Effect.catch((error) =>
        Effect.succeed(
          M.ChangedTurn({
            turn: {
              ...turnBase(turn),
              operation,
              state: "paused",
              stage: "waiting",
              error: failure(error),
            },
          }),
        ),
      ),
    );
  },
});
export const RetrieveQuestion = Command.define("RetrieveQuestion", {
  args: { turn: Turn },
  messages: [M.ChangedTurn],
  execute: ({ turn }) => {
    if (!("operation" in turn)) return Effect.succeed(M.ChangedTurn({ turn }));
    const operation = turn.operation;
    return result(
      request((client) => client.genieResult({ params: operation })),
    ).pipe(
      Effect.map(({ data, error }) =>
        M.ChangedTurn({
          turn: data
            ? { ...turnBase(turn), state: "complete", reply: data }
            : {
                ...turnBase(turn),
                operation,
                state: "paused",
                stage: "retrieving",
                error,
              },
        }),
      ),
    );
  },
});
export const PersistTurns = Command.define("PersistConversation", {
  args: { turns: History },
  messages: [M.Persisted],
  execute: ({ turns }) =>
    Effect.sync(() => {
      try {
        sessionStorage.setItem("metrocab.genie.v1", JSON.stringify(turns));
        return M.Persisted({ error: "" });
      } catch {
        return M.Persisted({
          error:
            "Conversation recovery could not be saved. Keep this tab open to retain the answer.",
        });
      }
    }),
});
export const CopySql = Command.define("CopySql", {
  args: { sql: Schema.String },
  messages: [M.CopiedSql],
  execute: ({ sql }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(sql)).pipe(
      Effect.match({
        onSuccess: () => M.CopiedSql({ text: "Copied" }),
        onFailure: () =>
          M.CopiedSql({
            text: "Unable to copy. Select the SQL above to copy it.",
          }),
      }),
    ),
});
export const ExportTrips = Command.define("ExportTrips", {
  args: { rows: Schema.Array(D.Trip), page: Schema.Number },
  messages: [M.Idle],
  execute: ({ rows, page }) =>
    done(
      Effect.sync(() => {
        const fields = [
          "trip_id",
          "pickup_at",
          "dropoff_at",
          "pickup_zip",
          "dropoff_zip",
          "distance",
          "fare",
          "duration",
        ] as const;
        const csv = [
          fields.join(","),
          ...rows.map((row) =>
            fields
              .map((field) => `"${String(row[field]).replaceAll('"', '""')}"`)
              .join(","),
          ),
        ].join("\r\n");
        const url = URL.createObjectURL(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `taxi-trips-page-${page}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }),
    ),
});
