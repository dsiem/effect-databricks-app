import { Schema } from "effect";
import {
  Filters,
  GenieContext,
  GenieOperation,
  GenieReply,
} from "../../../src/domain";

const Base = {
  id: Schema.String,
  question: Schema.String,
  filters: Schema.optionalKey(Filters),
  context: Schema.optionalKey(GenieContext),
};
export const Turn = Schema.Union([
  Schema.Struct({ ...Base, state: Schema.Literal("submitting") }),
  Schema.Struct({
    ...Base,
    state: Schema.Literal("submission-rejected"),
    error: Schema.String,
  }),
  Schema.Struct({
    ...Base,
    state: Schema.Literal("submission-unknown"),
    error: Schema.String,
  }),
  Schema.Struct({
    ...Base,
    state: Schema.Literal("waiting"),
    operation: GenieOperation,
  }),
  Schema.Struct({
    ...Base,
    state: Schema.Literal("retrieving"),
    operation: GenieOperation,
  }),
  Schema.Struct({
    ...Base,
    state: Schema.Literal("paused"),
    operation: GenieOperation,
    stage: Schema.Literals(["waiting", "retrieving"]),
    error: Schema.String,
  }),
  Schema.Struct({
    ...Base,
    state: Schema.Literal("failed"),
    operation: GenieOperation,
    error: Schema.String,
  }),
  Schema.Struct({
    ...Base,
    state: Schema.Literal("complete"),
    reply: GenieReply,
  }),
]);
export type Turn = typeof Turn.Type;
export const turnBase = ({ id, question, filters, context }: Turn) => ({
  id,
  question,
  ...(filters ? { filters } : {}),
  ...(context ? { context } : {}),
});
const History = Schema.Array(Turn);
const key = "metrocab.genie.v1";
const listeners = new Set<() => void>();
let persistenceError = "";
let turns: ReadonlyArray<Turn> = [];
try {
  const stored = sessionStorage.getItem(key);
  if (stored) {
    turns = Schema.decodeUnknownSync(History)(JSON.parse(stored)).map((turn) =>
      turn.state === "submitting"
        ? {
            ...turn,
            state: "submission-unknown",
            error:
              "The submission response was lost. The question may have been accepted. Check Genie before submitting it again.",
          }
        : turn,
    );
  }
} catch {
  persistenceError =
    "Conversation recovery is unavailable in this browser session.";
}
let snapshot = { turns, persistenceError };
export const genieSnapshot = () => snapshot;
export const subscribeGenie = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const saveTurns = (next: ReadonlyArray<Turn>) => {
  turns = next;
  try {
    sessionStorage.setItem(key, JSON.stringify(turns));
    persistenceError = "";
  } catch {
    persistenceError =
      "Conversation recovery could not be saved. Keep this tab open to retain the answer.";
  }
  snapshot = { turns, persistenceError };
  for (const listener of listeners) listener();
};
export const updateTurn = (id: string, update: (turn: Turn) => Turn) =>
  saveTurns(turns.map((turn) => (turn.id === id ? update(turn) : turn)));
export const conversationId = () => {
  for (const turn of turns.toReversed()) {
    if ("operation" in turn) return turn.operation.conversationId;
    if (turn.state === "complete") return turn.reply.conversationId;
  }
  return undefined;
};
