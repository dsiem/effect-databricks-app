import { Clock, Effect, Redacted, Schema, Semaphore } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import { withTransport } from "./internal/http.js";
import {
  failure,
  httpFailure,
  parseUrl,
  timeout,
} from "./internal/protocol.js";

export interface ClientCredentialsConfig {
  readonly host: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  /** Defaults to sql. Shared workspace services may request all-apis. */
  readonly scope?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  token_type: Schema.Literal("Bearer"),
  expires_in: Schema.Number.check(Schema.isGreaterThan(0), Schema.isFinite()),
});

/**
 * Workspace OAuth M2M provider. Tokens refresh before expiry; concurrent requests
 * share the refresh. Call once per identity and pass the effect as accessToken.
 */
export const clientCredentials = (
  options: ClientCredentialsConfig,
): Effect.Effect<Redacted.Redacted<string>, SqlError> => {
  const semaphore = Semaphore.makeUnsafe(1);
  let cached:
    | { token: Redacted.Redacted<string>; refreshAt: number }
    | undefined;
  return semaphore.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (cached && cached.refreshAt > now) return cached.token;
      const url = yield* Effect.try({
        try: () => {
          const url = parseUrl(options.host);
          if (url.pathname !== "/" || url.search || !options.clientId.trim())
            throw new Error("Invalid OAuth configuration");
          return new URL("/oidc/v1/token", url);
        },
        catch: () =>
          failure("Invalid Databricks OAuth configuration", "authenticate"),
      });
      const result = yield* withTransport(
        Effect.gen(function* () {
          const client = HttpClient.withScope(yield* HttpClient.HttpClient);
          const response = yield* client.execute(
            HttpClientRequest.post(url).pipe(
              HttpClientRequest.basicAuth(
                options.clientId,
                options.clientSecret,
              ),
              HttpClientRequest.bodyUrlParams({
                grant_type: "client_credentials",
                scope: options.scope ?? "sql",
              }),
            ),
          );
          return {
            status: response.status,
            data:
              response.status >= 200 && response.status < 300
                ? yield* response.json
                : undefined,
          };
        }),
        options.fetch,
      ).pipe(
        Effect.mapError((error) =>
          error.reason._tag === "DecodeError"
            ? failure("Invalid Databricks OAuth response", "authenticate")
            : new SqlError({
                reason: new ConnectionError({
                  cause: undefined,
                  message: "Databricks OAuth connection failed",
                  operation: "authenticate",
                }),
              }),
        ),
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () => Effect.fail(timeout("authenticate")),
        }),
      );
      if (result.status < 200 || result.status >= 300)
        return yield* Effect.fail(httpFailure(result.status, "authenticate"));
      const token = yield* Schema.decodeUnknownEffect(TokenResponse)(
        result.data,
      ).pipe(
        Effect.mapError(() =>
          failure("Invalid Databricks OAuth response", "authenticate"),
        ),
      );
      const lifetime = token.expires_in * 1000;
      cached = {
        token: Redacted.make(token.access_token),
        // Use the time before requesting, so request latency cannot extend expiry.
        refreshAt: now + lifetime - Math.min(60_000, lifetime / 10),
      };
      return cached.token;
    }),
  );
};
