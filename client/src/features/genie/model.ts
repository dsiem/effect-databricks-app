import { Schema } from "effect";
import * as D from "../../../../shared/domain";
export const TurnBase = {
  id: Schema.String,
  question: Schema.String,
  filters: Schema.optionalKey(D.Filters),
  context: Schema.optionalKey(D.GenieContext),
};
export const Turn = Schema.Union([
  Schema.Struct({ ...TurnBase, state: Schema.Literal("submitting") }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literals(["submission-rejected", "submission-unknown"]),
    error: Schema.String,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literals(["waiting", "retrieving"]),
    operation: D.GenieOperation,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("paused"),
    operation: D.GenieOperation,
    stage: Schema.Literals(["waiting", "retrieving"]),
    error: Schema.String,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("failed"),
    operation: D.GenieOperation,
    error: Schema.String,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("complete"),
    reply: D.GenieReply,
  }),
]);
export type Turn = typeof Turn.Type;
export const turnBase = ({ id, question, filters, context }: Turn) => ({
  id,
  question,
  ...(filters ? { filters } : {}),
  ...(context ? { context } : {}),
});
export const History = Schema.Array(Turn);
export const fields = {
  genieOpen: Schema.Boolean,
  genieExpanded: Schema.Boolean,
  genieDraft: Schema.String,
  genieSelection: Schema.NullOr(D.GenieContext),
  turns: History,
  persistenceError: Schema.String,
  clipboard: Schema.String,
};
