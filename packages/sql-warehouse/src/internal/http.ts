import { Effect, type Scope } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

// Scope the response body as well as the request. Closing the scope releases
// unread error bodies and aborts downloads interrupted after their headers arrive.
export const withTransport = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient | Scope.Scope>,
  fetch: typeof globalThis.fetch | undefined,
  workspaceClient?: HttpClient.HttpClient,
): Effect.Effect<A, E> => {
  const scoped = Effect.scoped(effect);
  const request = workspaceClient
    ? Effect.provideService(scoped, HttpClient.HttpClient, workspaceClient)
    : scoped.pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch ?? globalThis.fetch),
      );
  return Effect.provideService(request, FetchHttpClient.RequestInit, {
    credentials: "omit",
    redirect: "error",
  });
};
