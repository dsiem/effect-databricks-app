import { Effect, Schema, type Scope } from "effect";
import { ApiError } from "../../../shared/api";
import { Message as M } from "../app/message";

export const failure = (error: unknown) =>
  Schema.is(ApiError)(error)
    ? error.error.message
    : "Unable to complete the request. Check your connection and retry.";
// The shared HTTP contract is the only network error boundary.
export const result = <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>) =>
  effect.pipe(
    Effect.scoped,
    Effect.match({
      onSuccess: (data) => ({ data, error: "" }),
      onFailure: (error) => ({ data: null, error: failure(error) }),
    }),
  );
export const done = (effect: Effect.Effect<unknown>) =>
  effect.pipe(Effect.as(M.Idle()));
