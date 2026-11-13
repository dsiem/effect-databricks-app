import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { Credentials } from "effect-sql-databricks";
import {
  OperationTimeout,
  type ServiceError,
  UpstreamError,
  unavailable,
} from "./errors.js";
import { Settings } from "./settings.js";

const run = promisify(execFile);
const CliToken = Schema.Struct({ access_token: Schema.NonEmptyString });

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly accessToken: Effect.Effect<
      Redacted.Redacted<string>,
      ServiceError
    >;
    readonly request: (
      path: string,
      method?: "GET" | "POST",
      body?: unknown,
    ) => Effect.Effect<unknown, ServiceError>;
  }
>()("app/Workspace") {
  static readonly layer = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const authError = (cause: unknown) =>
        unavailable(
          "auth",
          "Databricks authentication failed. Run databricks auth login locally, or check the app service principal.",
          cause,
        );
      const cli = yield* Effect.tryPromise({
        try: async (signal) =>
          JSON.parse(
            (
              await run(
                "databricks",
                [
                  "auth",
                  "token",
                  ...(settings.profile ? ["--profile", settings.profile] : []),
                ],
                { signal, timeout: 15000, maxBuffer: 1024 * 1024 },
              )
            ).stdout,
          ) as unknown,
        catch: (cause) => cause,
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CliToken)),
        Effect.map((value) => Redacted.make(value.access_token)),
        Effect.mapError(authError),
        Effect.cachedWithTTL("30 seconds"),
      );
      const accessToken = Redacted.value(settings.token)
        ? Effect.succeed(settings.token)
        : settings.clientId && Redacted.value(settings.clientSecret)
          ? Credentials.clientCredentials({
              host: settings.host,
              clientId: settings.clientId,
              clientSecret: settings.clientSecret,
              scope: "all-apis",
            }).pipe(Effect.mapError(authError))
          : cli;
      const request = (
        path: string,
        method: "GET" | "POST" = "GET",
        body?: unknown,
      ) =>
        Effect.gen(function* () {
          if (!settings.host)
            return yield* Effect.fail(
              unavailable(
                "workspace",
                "Set DATABRICKS_HOST to your workspace URL.",
              ),
            );
          const token = yield* accessToken;
          return yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(
                `${settings.host.replace(/\/$/, "")}${path}`,
                {
                  method,
                  signal,
                  redirect: "error",
                  credentials: "omit",
                  headers: {
                    Authorization: `Bearer ${Redacted.value(token)}`,
                    "Content-Type": "application/json",
                  },
                  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                },
              );
              if (!response.ok) {
                await response.body?.cancel();
                throw new UpstreamError({
                  service: "workspace",
                  upstreamStatus: response.status,
                  message: `Databricks returned HTTP ${response.status}. Check resource permissions and configuration.`,
                });
              }
              return (await response.json()) as unknown;
            },
            catch: (cause) =>
              cause instanceof UpstreamError
                ? cause
                : unavailable(
                    "workspace",
                    "The Databricks request could not be completed.",
                    cause,
                  ),
          });
        }).pipe(
          Effect.timeoutOrElse({
            duration: "30 seconds",
            orElse: () =>
              Effect.fail(
                new OperationTimeout({
                  service: "workspace",
                  message: "Databricks request timed out.",
                }),
              ),
          }),
        );
      return { accessToken, request };
    }),
  );
}
