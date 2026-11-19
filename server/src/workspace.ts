import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { Credentials } from "@dsiem/sql-warehouse";
import {
  OperationTimeout,
  type ServiceUnavailable,
  type WorkspaceRequestError,
  UpstreamError,
  unavailable,
} from "./errors.js";
import { Settings } from "./settings.js";

const run = promisify(execFile);
const CliToken = Schema.Struct({ access_token: Schema.NonEmptyString });
const featureDisabled = Schema.is(
  Schema.Struct({ error_code: Schema.Literal("FEATURE_DISABLED") }),
);

type ReadEventStream = (
  body: HttpClientResponse.HttpClientResponse["stream"],
) => Effect.Effect<unknown, unknown>;

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly accessToken: Effect.Effect<
      Redacted.Redacted<string>,
      ServiceUnavailable
    >;
    readonly request: (
      path: string,
      method?: "GET" | "POST",
      body?: unknown,
      readEventStream?: ReadEventStream,
    ) => Effect.Effect<unknown, WorkspaceRequestError>;
  }
>()("app/Workspace") {
  static readonly layer = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const client = yield* HttpClient.HttpClient;
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
        readEventStream?: ReadEventStream,
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
          return yield* Effect.gen(function* () {
            const jsonRequest = HttpClientRequest.make(method)(
              `${settings.host.replace(/\/$/, "")}${path}`,
            ).pipe(
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.setHeader("Content-Type", "application/json"),
            );
            const request = readEventStream
              ? HttpClientRequest.setHeader(
                  jsonRequest,
                  "Accept",
                  "text/event-stream",
                )
              : jsonRequest;
            const response = yield* HttpClient.withScope(client).execute(
              body === undefined
                ? request
                : yield* HttpClientRequest.bodyJson(request, body),
            );
            if (response.status < 200 || response.status >= 300) {
              const disabled =
                response.status === 404 &&
                readEventStream !== undefined &&
                (yield* response.json.pipe(
                  Effect.map(featureDisabled),
                  Effect.orElseSucceed(() => false),
                ));
              return yield* Effect.fail(
                new UpstreamError({
                  service: "workspace",
                  upstreamStatus: response.status,
                  ...(disabled
                    ? { upstreamCode: "FEATURE_DISABLED" as const }
                    : {}),
                  message: `Databricks returned HTTP ${response.status}. Check resource permissions and configuration.`,
                }),
              );
            }
            return yield* readEventStream
              ? readEventStream(response.stream)
              : response.json;
          }).pipe(
            Effect.scoped,
            Effect.provideService(FetchHttpClient.RequestInit, {
              redirect: "error",
              credentials: "omit",
            }),
            Effect.mapError((cause) =>
              cause instanceof UpstreamError
                ? cause
                : unavailable(
                    "workspace",
                    "The Databricks request could not be completed.",
                    cause,
                  ),
            ),
          );
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
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
