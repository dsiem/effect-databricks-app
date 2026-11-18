import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import { ApiError, genieResultTimeoutMs } from "../../../../shared/api";
import { request } from "../../lib/api-client";
import { failure, result } from "../../lib/command-result";
import { Message as M, QuestionSnapshot } from "./messages";
import { History, Turn, turnBase } from "./model";
const genieStorageKey = "databricks-effect-app.genie.v1";

export const RestoreConversation = Command.define("RestoreConversation", {
  messages: [M.RestoredConversation],
  execute: Effect.sync(() => {
    let turns: typeof History.Type = [];
    let persistenceError = "";
    try {
      const stored = sessionStorage.getItem(genieStorageKey);
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
    return M.RestoredConversation({ turns, persistenceError });
  }),
});
export const CreateTurn = Command.define("CreateQuestion", {
  args: QuestionSnapshot.fields,
  messages: [M.CreatedTurn],
  execute: (snapshot) =>
    Effect.sync(() => M.CreatedTurn({ ...snapshot, id: crypto.randomUUID() })),
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
export const RetrieveQuestion = Command.define("RetrieveQuestion", {
  args: { turn: Turn },
  messages: [M.ChangedTurn],
  execute: ({ turn }) => {
    if (!("operation" in turn)) return Effect.succeed(M.ChangedTurn({ turn }));
    const operation = turn.operation;
    return result(
      request(
        (client) => client.genieResult({ params: operation }),
        genieResultTimeoutMs + 15_000,
      ),
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
        sessionStorage.setItem(genieStorageKey, JSON.stringify(turns));
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
