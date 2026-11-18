import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";
import { History, Turn } from "./model";

export const QuestionSnapshot = Schema.Struct({
  question: Schema.String,
  filters: D.Filters,
  context: D.GenieContext,
});

export const PollTarget = Schema.Struct({
  id: Schema.String,
  operation: D.GenieOperation,
});

const PollOutcome = Schema.Union([
  Schema.Struct({ state: Schema.Literal("retrieving") }),
  Schema.Struct({
    state: Schema.Literal("paused"),
    stage: Schema.Literal("waiting"),
    error: Schema.String,
  }),
  Schema.Struct({ state: Schema.Literal("failed"), error: Schema.String }),
]);

export const messages = {
  CloseGenie: {},
  GenieDialog: { message: Dialog.Message },
  RestoredConversation: { turns: History, persistenceError: Schema.String },
  OpenGenie: {
    context: Schema.NullOr(D.GenieContext),
    question: Schema.NullOr(Schema.String),
  },
  ExpandGenie: {},
  ClearSelection: {},
  GenieDraft: { value: Schema.String },
  SendQuestion: { question: Schema.String },
  CreatedTurn: { id: Schema.String, ...QuestionSnapshot.fields },
  ChangedTurn: { turn: Turn },
  PolledQuestion: {
    ...PollTarget.fields,
    generation: Schema.Int,
    outcome: PollOutcome,
  },
  ResumeTurn: { id: Schema.String },
  EditQuestion: { question: Schema.String },
  NewConversation: {},
  Persisted: { error: Schema.String },
  CopySql: { sql: Schema.String },
  CopiedSql: { text: Schema.String },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
