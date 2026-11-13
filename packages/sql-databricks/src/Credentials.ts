import { Clock, Effect, Redacted, Schema, Semaphore } from "effect";
import { AuthenticationError, SqlError } from "effect/sql/SqlError";
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
      const result = yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await (options.fetch ?? globalThis.fetch)(url, {
            method: "POST",
            signal,
            credentials: "omit",
            redirect: "error",
            headers: {
              Authorization: `Basic ${Buffer.from(`${options.clientId}:${Redacted.value(options.clientSecret)}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "client_credentials",
              scope: "sql",
            }),
          });
          if (!response.ok) {
            await response.body?.cancel();
            return { status: response.status, data: undefined };
          }
          return {
            status: response.status,
            data: (await response.json()) as unknown,
          };
        },
        catch: () =>
          new SqlError({
            reason: new AuthenticationError({
              cause: undefined,
              message: "Databricks OAuth request failed",
              operation: "authenticate",
            }),
          }),
      }).pipe(
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
