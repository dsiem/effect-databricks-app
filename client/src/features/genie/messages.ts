import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";
import { Turn } from "./model";

export const messages = {
  OpenGenie: {
    context: Schema.NullOr(D.GenieContext),
    question: Schema.NullOr(Schema.String),
  },
  ExpandGenie: {},
  ClearSelection: {},
  GenieDraft: { value: Schema.String },
  SendQuestion: { question: Schema.String },
  CreatedTurn: { id: Schema.String, question: Schema.String },
  ChangedTurn: { turn: Turn },
  ResumeTurn: { id: Schema.String },
  EditQuestion: { question: Schema.String },
  NewConversation: {},
  Persisted: { error: Schema.String },
  CopySql: { sql: Schema.String },
  CopiedSql: { text: Schema.String },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
