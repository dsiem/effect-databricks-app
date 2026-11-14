import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

export const messages = {
  FilterChanged: {
    field: Schema.Literals(["from", "to", "zip"]),
    value: Schema.String,
  },
  ApplyFilters: {},
  ResetFilters: {},
  PickZip: { zip: Schema.String },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
