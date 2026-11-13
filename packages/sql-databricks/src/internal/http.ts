import { Effect, type Scope } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";

// Scope the response body as well as the request. Closing the scope releases
// unread error bodies and aborts downloads interrupted after their headers arrive.
export const withTransport = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient | Scope.Scope>,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Effect.Effect<A, E> =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
    Effect.provideService(FetchHttpClient.RequestInit, {
      credentials: "omit",
      redirect: "error",
    }),
  );
