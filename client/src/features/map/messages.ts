import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

export const messages = {
  MapReady: {
    query: Schema.String,
    mapped: Schema.Number,
    error: Schema.String,
  },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
