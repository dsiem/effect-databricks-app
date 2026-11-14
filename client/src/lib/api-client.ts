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

// Preserve the shared contract's discriminants when adapting Effect to React.
export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  readonly code: typeof ApiError.Type.error.code;
  readonly upstreamStatus: number | undefined;

  constructor(error: typeof ApiError.Type.error) {
    super(error.message);
    this.code = error.code;
    this.upstreamStatus =
      "upstreamStatus" in error ? error.upstreamStatus : undefined;
  }
}

export const api = <A, E>(
  effect: Effect.Effect<A, E, Scope.Scope>,
  signal?: AbortSignal,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.mapError((error) =>
        Schema.is(ApiError)(error)
          ? new ApiRequestError(error.error)
          : new Error(
              "Unable to complete the request. Check your connection and retry.",
            ),
      ),
    ),
    signal ? { signal } : {},
  );
