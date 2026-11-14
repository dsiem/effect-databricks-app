import { Schema } from "effect";
export const request = <S extends Schema.Top>(data: S) =>
  Schema.Struct({
    data: Schema.NullOr(data),
    error: Schema.String,
    loading: Schema.Boolean,
  });

export const empty = { data: null, error: "", loading: false };
export const pending = { ...empty, loading: true };
