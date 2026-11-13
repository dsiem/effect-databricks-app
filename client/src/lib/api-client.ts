import { Effect, Schema, type Scope } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { ApiError, AppApi } from "../../../src/api.js";

export const apiClient = Effect.runSync(
  Effect.gen(function* () {
    const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);
    return yield* HttpApiClient.makeWith(AppApi, { httpClient });
  }).pipe(Effect.provide(FetchHttpClient.layer)),
).app;

// Keep the schema-derived errors in Effect; adapt them to Error at the UI boundary.
export const api = <A, E>(
  effect: Effect.Effect<A, E, Scope.Scope>,
  signal?: AbortSignal,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.mapError(
        (error) =>
          new Error(
            Schema.is(ApiError)(error)
              ? error.error.message
              : "Unable to complete the request. Check your connection and retry.",
          ),
      ),
    ),
    signal ? { signal } : {},
  );
