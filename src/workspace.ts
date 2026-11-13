import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { Credentials } from "effect-sql-databricks";
import { AppError, unavailable } from "./domain.js";
import { Settings } from "./settings.js";

const run = promisify(execFile);
const CliToken = Schema.Struct({ access_token: Schema.NonEmptyString });

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly accessToken: Effect.Effect<Redacted.Redacted<string>, AppError>;
    readonly request: (
      path: string,
      method?: "GET" | "POST",
      body?: unknown,
    ) => Effect.Effect<unknown, AppError>;
  }
>()("app/Workspace") {
  static readonly layer = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const authError = unavailable(
        "auth",
        "Databricks authentication failed. Run databricks auth login locally, or check the app service principal.",
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
        catch: () => authError,
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CliToken)),
        Effect.map((value) => Redacted.make(value.access_token)),
        Effect.mapError(() => authError),
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
            }).pipe(Effect.mapError(() => authError))
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
                throw new AppError({
                  status: 502,
                  code: "workspace_request_failed",
                  message: `Databricks returned HTTP ${response.status}. Check resource permissions and configuration.`,
                });
              }
              return (await response.json()) as unknown;
            },
            catch: (cause) =>
              cause instanceof AppError
                ? cause
                : unavailable(
                    "workspace",
                    "The Databricks request could not be completed.",
                  ),
          });
        }).pipe(
          Effect.timeoutOrElse({
            duration: "30 seconds",
            orElse: () =>
              Effect.fail(
                unavailable("workspace", "Databricks request timed out."),
              ),
          }),
        );
      return { accessToken, request };
    }),
  );
}
