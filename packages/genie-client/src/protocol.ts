import { Data, Effect, Schema } from "effect";

export const GenieId = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9-]{1,100}$/),
);

export class GenieResponseError extends Data.TaggedError("GenieResponseError")<{
  readonly cause: unknown;
}> {}

export class GenieMessageUnavailable extends Data.TaggedError(
  "GenieMessageUnavailable",
)<{
  readonly status: string;
  readonly state: "pending" | "failed";
}> {}

export const decode = <A>(schema: Schema.Decoder<A>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new GenieResponseError({ cause })),
  );
