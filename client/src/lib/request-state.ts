import { Schema } from "effect";
export const AccessDenied = Schema.TaggedStruct("AccessDenied", {
  message: Schema.String,
});
export const Notice = Schema.Union([Schema.String, AccessDenied]);
export type Notice = typeof Notice.Type;

export const request = <S extends Schema.Top>(data: S) =>
  Schema.Struct({
    data: Schema.NullOr(data),
    error: Notice,
    loading: Schema.Boolean,
  });

export type RequestState<S extends Schema.Top> = ReturnType<
  typeof request<S>
>["Type"];

export const empty = { data: null, error: "", loading: false };
export const pending = { ...empty, loading: true };
