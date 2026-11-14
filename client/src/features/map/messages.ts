import { Schema } from "effect";

export const messages = {
  MapReady: {
    query: Schema.String,
    mapped: Schema.Number,
    error: Schema.String,
  },
};
