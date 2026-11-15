import { Schema } from "effect";
export const request = <S extends Schema.Top>(data: S) =>
  Schema.Struct({
    data: Schema.NullOr(data),
    error: Schema.String,
    loading: Schema.Boolean,
  });

export type RequestState<S extends Schema.Top> = ReturnType<
  typeof request<S>
>["Type"];

export const empty = { data: null, error: "", loading: false };
export const pending = { ...empty, loading: true };
