import { Notice } from "../../lib/request-state";
import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
export const TurnBase = {
  id: Schema.String,
  question: Schema.String,
  filters: Schema.optionalKey(D.Filters),
  context: Schema.optionalKey(D.GenieContext),
  ...D.GenieModeQuery.fields,
};
export const Turn = Schema.Union([
  Schema.Struct({ ...TurnBase, state: Schema.Literal("submitting") }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literals([
      "submission-rejected",
      "submission-unknown",
      "agent-mode-unavailable",
    ]),
    error: Notice,
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
    error: Notice,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("failed"),
    operation: D.GenieOperation,
    error: Notice,
  }),
  Schema.Struct({
    ...TurnBase,
    state: Schema.Literal("complete"),
    reply: D.GenieReply,
  }),
]);
export type Turn = typeof Turn.Type;
export const turnBase = ({ id, question, filters, context, mode }: Turn) => ({
  id,
  question,
  ...(filters ? { filters } : {}),
  ...(context ? { context } : {}),
  ...(mode ? { mode } : {}),
});
export const History = Schema.Array(Turn);
export const Model = Schema.Struct({
  helperDialog: Dialog.Model,
  genieOpen: Schema.Boolean,
  genieExpanded: Schema.Boolean,
  genieDraft: Schema.String,
  genieMode: D.GenieMode,
  genieSelection: Schema.NullOr(D.GenieContext),
  turns: History,
  pollGeneration: Schema.Int,
  persistenceError: Schema.String,
  clipboard: Schema.String,
});

export type Model = typeof Model.Type;

export const busy = (model: Model) =>
  model.turns.some((turn) =>
    ["submitting", "waiting", "retrieving"].includes(turn.state),
  );

export const init = (): Model => ({
  helperDialog: Dialog.init({
    id: "genie-helper",
    focusSelector: "#genie-composer",
  }),
  genieOpen: false,
  genieExpanded: false,
  genieDraft: "",
  genieMode: "chat",
  genieSelection: null,
  turns: [],
  pollGeneration: 0,
  persistenceError: "",
  clipboard: "",
});
