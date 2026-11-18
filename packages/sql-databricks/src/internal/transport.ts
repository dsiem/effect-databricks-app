import { Duration, Effect, Schedule, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import type { DatabricksClientConfig } from "../DatabricksClient.js";
import { withTransport } from "./http.js";
import { failure, httpFailure, parseUrl, timeout } from "./protocol.js";

export const makeTransport = (options: DatabricksClientConfig) =>
  Effect.gen(function* () {
    const config = yield* Effect.try({
      try: () => {
        const host = parseUrl(options.host);
        if (
          host.pathname !== "/" ||
          host.search ||
          !options.warehouseId.trim()
        ) {
          throw new Error(
            "Expected a workspace origin and a nonempty warehouse ID",
          );
        }
        const poll = Duration.toMillis(
          Duration.fromInputUnsafe(options.pollInterval ?? "250 millis"),
        );
        const query = Duration.toMillis(
          Duration.fromInputUnsafe(options.queryTimeout ?? "2 minutes"),
        );
        const request = Duration.toMillis(
          Duration.fromInputUnsafe(options.requestTimeout ?? "30 seconds"),
        );
        if (![poll, query, request].every((n) => Number.isFinite(n) && n > 0)) {
          throw new Error(
            "Timeouts and polling interval must be positive finite durations",
          );
        }
        if (
          options.byteLimit !== undefined &&
          (!Number.isSafeInteger(options.byteLimit) || options.byteLimit <= 0)
        ) {
          throw new Error("byteLimit must be a positive safe integer");
        }
        return { host: host.origin, poll, query, request };
      },
      catch: () =>
        failure("Invalid Databricks client configuration", "configure"),
    });
    const withQueryTimeout = <A, E, R>(consumer: Effect.Effect<A, E, R>) =>
      consumer.pipe(
        Effect.timeoutOrElse({
          duration: config.query,
          orElse: () => Effect.fail(timeout("query")),
        }),
      );

    const requestJson = (
      path: string,
      method: "GET" | "POST",
      body?: unknown,
    ) => {
      const operation =
        method === "GET" ? "poll/fetch metadata" : "submit/cancel";
      const request = Effect.gen(function* () {
        const token = yield* options.accessToken;
        const response = yield* withTransport(
          Effect.gen(function* () {
            const client = HttpClient.withScope(yield* HttpClient.HttpClient);
            const request = HttpClientRequest.make(method)(
              `${config.host}${path}`,
            ).pipe(HttpClientRequest.bearerToken(token));
            const response = yield* client.execute(
              body === undefined
                ? request
                : yield* HttpClientRequest.bodyJson(request, body),
            );
            // Never retain upstream bodies, request headers, or signed URLs in errors.
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
          Effect.mapError(
            () =>
              new SqlError({
                reason: new ConnectionError({
                  cause: undefined,
                  message: "Databricks workspace request failed",
                  operation,
                }),
              }),
          ),
        );
        if (response.status < 200 || response.status >= 300) {
          return yield* Effect.fail(httpFailure(response.status, operation));
        }
        return response.data;
      }).pipe(
        Effect.timeoutOrElse({
          duration: config.request,
          orElse: () => Effect.fail(timeout(operation)),
        }),
      );
      // A lost submission response is ambiguous: never automatically replay SQL.
      return method === "GET"
        ? request.pipe(
            Effect.retry({
              while: (error) => error.reason._tag === "ConnectionError",
              times: 2,
              schedule: Schedule.exponential("100 millis"),
            }),
          )
        : request;
    };

    const download = (url: string, maxBytes?: number) =>
      Effect.gen(function* () {
        const safeUrl = yield* Effect.try({
          try: () => parseUrl(url, options.allowDatabricksStorageProxy),
          catch: () => failure("Invalid Arrow download URL", "download"),
        });
        return yield* withTransport(
          Effect.gen(function* () {
            // Fresh request: signed storage URLs never inherit workspace headers.
            const client = HttpClient.withScope(yield* HttpClient.HttpClient);
            const response = yield* client.get(safeUrl);
            if (response.status < 200 || response.status >= 300)
              return { status: response.status, bytes: new Uint8Array() };
            if (maxBytes === undefined)
              return {
                status: response.status,
                bytes: new Uint8Array(yield* response.arrayBuffer),
              };
            const parts: Uint8Array[] = [];
            let size = 0;
            yield* Stream.runForEach(response.stream, (part) =>
              Effect.gen(function* () {
                size += part.byteLength;
                if (size > maxBytes)
                  return yield* Effect.fail(
                    failure("Arrow result exceeds the byte limit", "download"),
                  );
                parts.push(part);
              }),
            );
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const part of parts) {
              bytes.set(part, offset);
              offset += part.byteLength;
            }
            return {
              status: response.status,
              bytes,
            };
          }).pipe(
            Effect.provideService(HttpClient.TracerPropagationEnabled, false),
          ),
          options.fetch,
        ).pipe(
          Effect.mapError((error) =>
            error instanceof SqlError
              ? error
              : failure("Arrow download failed", "download"),
          ),
        );
      }).pipe(
        Effect.timeoutOrElse({
          duration: config.request,
          orElse: () => Effect.fail(timeout("download")),
        }),
      );

    return { config, requestJson, download, withQueryTimeout };
  });
