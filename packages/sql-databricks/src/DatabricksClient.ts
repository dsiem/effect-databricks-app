import { type RecordBatch, Table, tableFromIPC } from "apache-arrow";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Redacted,
  Schedule,
  Schema,
  Stream,
} from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Client from "effect/sql/SqlClient";
import type { Connection } from "effect/sql/SqlConnection";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import * as Statement from "effect/sql/Statement";
import {
  failure,
  httpFailure,
  parameter,
  parseUrl,
  ResultChunk,
  StatementResponse,
  statementFailure,
  TypedParameter,
  timeout,
} from "./internal/protocol.js";

export interface DatabricksClient extends Client.Base {
  /** Materializes all result chunks as one columnar Arrow table. */
  readonly arrow: (
    statement: Statement.Statement<unknown>,
  ) => Effect.Effect<Table, SqlError>;
  /** Pulls one Databricks result chunk at a time, preserving its Arrow schema. */
  readonly arrowChunks: (
    statement: Statement.Statement<unknown>,
  ) => Stream.Stream<Table, SqlError>;
  /** Emits record batches without constructing JavaScript row objects. */
  readonly arrowStream: (
    statement: Statement.Statement<unknown>,
  ) => Stream.Stream<RecordBatch, SqlError>;
  /** Each element is an independent, complete Arrow IPC stream. Do not concatenate. */
  readonly ipcStream: (
    statement: Statement.Statement<unknown>,
  ) => Stream.Stream<Uint8Array, SqlError>;
  /** Applies queryTimeout to a complete consumer, including downstream work. */
  readonly withQueryTimeout: <A, E, R>(
    consumer: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqlError, R>;
  /** Bind e.g. DECIMAL(38, 2), DATE, or a typed NULL without lossy conversion. */
  readonly param: (type: string, value: string | null) => Statement.Fragment;
}

export const DatabricksClient = Context.Service<DatabricksClient>(
  "effect-sql-databricks/DatabricksClient",
);

export interface DatabricksClientConfig {
  readonly host: string;
  readonly warehouseId: string;
  /** Evaluated for every workspace request, allowing expiry-aware token providers. */
  readonly accessToken: Effect.Effect<Redacted.Redacted<string>, SqlError>;
  readonly catalog?: string;
  readonly schema?: string;
  readonly pollInterval?: Duration.Input;
  /** Source deadline for submission, polling, and downloads. Use withQueryTimeout for downstream work. Default: 2 minutes. */
  readonly queryTimeout?: Duration.Input;
  /** Deadline per HTTP request, including its body. Default: 30 seconds. */
  readonly requestTimeout?: Duration.Input;
  /** Optional server result limit. Truncation is always reported as an error. */
  readonly byteLimit?: number;
  readonly fetch?: typeof globalThis.fetch;
  /** Opt in only inside Databricks Apps, whose managed network rewrites signed result links to this exact internal HTTP proxy. Workspace credentials are never forwarded. */
  readonly allowDatabricksStorageProxy?: boolean;
}

/** Spark SQL uses backticks and the REST API requires named parameter markers. */
export const makeCompiler = (): Statement.Compiler =>
  Statement.makeCompiler({
    // Effect 4.1's closed dialect union has no Spark entry. The mysql branch
    // supplies compatible generic helper behavior; this is still a Spark compiler.
    dialect: "mysql",
    placeholder: (index) => `:p${index}`,
    onIdentifier: Statement.defaultEscape("`"),
    onRecordUpdate() {
      throw new Error(
        "Databricks does not support Effect's updateValues helper",
      );
    },
    onCustom() {
      throw new Error("Unsupported custom SQL fragment for Databricks");
    },
  });

// Spark is absent from Effect's dialect union. Never dispatch a caller's MySQL SQL.
const sparkDialect: Pick<
  Statement.Constructor,
  "onDialect" | "onDialectOrElse"
> = {
  onDialect: () => {
    throw new Error(
      "Spark SQL has no Effect dialect branch; use onDialectOrElse or sql.driver",
    );
  },
  onDialectOrElse: (options) => options.orElse(),
};

export const make = (
  options: DatabricksClientConfig,
): Effect.Effect<
  DatabricksClient & Client.SqlClient,
  SqlError,
  Reactivity.Reactivity
> =>
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
    const fetch = options.fetch ?? globalThis.fetch;
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
        const response = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await fetch(`${config.host}${path}`, {
              method,
              signal,
              credentials: "omit",
              redirect: "error",
              headers: {
                Authorization: `Bearer ${Redacted.value(token)}`,
                ...(body === undefined
                  ? {}
                  : { "Content-Type": "application/json" }),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            // Do not retain untrusted response bodies, request headers, or signed URLs in errors.
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
              reason: new ConnectionError({
                cause: undefined,
                message: "Databricks workspace request failed",
                operation,
              }),
            }),
        });
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

    const decode = <S extends Schema.Top>(schema: S, input: unknown) =>
      Schema.decodeUnknownEffect(schema)(input).pipe(
        Effect.mapError(() =>
          failure("Invalid Databricks API response", "decode"),
        ),
      );

    const download = (url: string) =>
      Effect.gen(function* () {
        const safeUrl = yield* Effect.try({
          try: () => parseUrl(url, options.allowDatabricksStorageProxy),
          catch: () => failure("Invalid Arrow download URL", "download"),
        });
        const response = yield* Effect.tryPromise({
          try: async (signal) => {
            // This request must never inherit workspace authorization headers.
            const response = await fetch(safeUrl, {
              signal,
              credentials: "omit",
              redirect: "error",
            });
            if (!response.ok) {
              await response.body?.cancel();
              return { status: response.status, bytes: new Uint8Array() };
            }
            return {
              status: response.status,
              bytes: new Uint8Array(await response.arrayBuffer()),
            };
          },
          catch: () => failure("Arrow download failed", "download"),
        });
        return response;
      }).pipe(
        Effect.timeoutOrElse({
          duration: config.request,
          orElse: () => Effect.fail(timeout("download")),
        }),
      );

    const ipc = (
      sql: string,
      params: ReadonlyArray<unknown>,
    ): Stream.Stream<Uint8Array, SqlError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const parameters = yield* Effect.try({
            try: () => params.map(parameter),
            catch: () =>
              failure(
                "Unsupported SQL parameter; use sql.param for an explicit type",
                "bind",
              ),
          });
          const query = yield* Effect.acquireRelease(
            requestJson("/api/2.0/sql/statements", "POST", {
              warehouse_id: options.warehouseId,
              statement: sql,
              parameters,
              format: "ARROW_STREAM",
              disposition: "EXTERNAL_LINKS",
              wait_timeout: "0s",
              ...(options.catalog === undefined
                ? {}
                : { catalog: options.catalog }),
              ...(options.schema === undefined
                ? {}
                : { schema: options.schema }),
              ...(options.byteLimit === undefined
                ? {}
                : { byte_limit: options.byteLimit }),
            }).pipe(
              Effect.flatMap((value) => decode(StatementResponse, value)),
              Effect.map((current) => ({ current })),
            ),
            (query) =>
              Effect.suspend(() =>
                query.current.status.state === "PENDING" ||
                query.current.status.state === "RUNNING"
                  ? requestJson(
                      `/api/2.0/sql/statements/${encodeURIComponent(query.current.statement_id)}/cancel`,
                      "POST",
                    ).pipe(Effect.timeoutOption("5 seconds"), Effect.ignore)
                  : Effect.void,
              ),
            // A lost response is already an ambiguous outcome. Abort the request
            // promptly instead of shielding submission from the caller's deadline.
            { interruptible: true },
          );
          const path = `/api/2.0/sql/statements/${encodeURIComponent(query.current.statement_id)}`;
          while (
            query.current.status.state === "PENDING" ||
            query.current.status.state === "RUNNING"
          ) {
            yield* Effect.sleep(config.poll);
            const next = yield* requestJson(path, "GET").pipe(
              Effect.flatMap((value) => decode(StatementResponse, value)),
            );
            if (next.statement_id !== query.current.statement_id) {
              return yield* Effect.fail(
                failure("Databricks returned a different statement ID", "poll"),
              );
            }
            query.current = next;
          }
          if (query.current.status.state !== "SUCCEEDED") {
            return yield* Effect.fail(statementFailure(query.current.status));
          }
          const manifest = query.current.manifest;
          if (manifest?.format !== "ARROW_STREAM" || manifest.truncated) {
            return yield* Effect.fail(
              failure(
                "Expected complete, untruncated Arrow results",
                "manifest",
              ),
            );
          }
          const first = query.current.result;
          const chunkLink = (index: number, cached?: ResultChunk) =>
            Effect.gen(function* () {
              const metadata =
                cached ??
                (yield* requestJson(
                  `${path}/result/chunks/${index}`,
                  "GET",
                ).pipe(Effect.flatMap((value) => decode(ResultChunk, value))));
              const link = metadata.external_links?.find(
                (link) => link.chunk_index === index,
              );
              if (!link) {
                return yield* Effect.fail(
                  failure("Missing Arrow result chunk", "metadata"),
                );
              }
              return link.external_link;
            });
          if (manifest.total_chunk_count === 0) return Stream.empty;
          return Stream.range(0, manifest.total_chunk_count - 1).pipe(
            Stream.mapEffect((index) =>
              Effect.gen(function* () {
                const cached =
                  index === 0 &&
                  first?.external_links?.some((link) => link.chunk_index === 0)
                    ? first
                    : undefined;
                const url = yield* chunkLink(index, cached);
                let result = yield* download(url);
                // Signed URLs can expire while the downstream consumer is paused.
                if (result.status === 401 || result.status === 403) {
                  result = yield* download(yield* chunkLink(index));
                }
                if (result.status < 200 || result.status >= 300) {
                  return yield* Effect.fail(
                    httpFailure(result.status, "download"),
                  );
                }
                return result.bytes;
              }),
            ),
          );
        }),
      ).pipe(
        Stream.interruptWhen(
          Effect.sleep(config.query).pipe(
            Effect.andThen(Effect.fail(timeout("query"))),
          ),
        ),
        Stream.withSpan("databricks.query"),
      );

    const chunks = (sql: string, params: ReadonlyArray<unknown>) =>
      ipc(sql, params).pipe(
        Stream.mapEffect((bytes) =>
          Effect.try({
            try: () => tableFromIPC(bytes),
            catch: () => failure("Invalid Arrow IPC result", "decodeArrow"),
          }),
        ),
      );
    const collectTable = (source: Stream.Stream<Table, SqlError>) =>
      source.pipe(
        Stream.runCollect,
        Effect.flatMap((tables) =>
          Effect.try({
            try: () => {
              const first = tables[0];
              return first
                ? new Table(
                    first.schema,
                    tables.flatMap((table) => table.batches),
                  )
                : new Table();
            },
            catch: () =>
              failure(
                "Incompatible Arrow schemas across result chunks",
                "decodeArrow",
              ),
          }),
        ),
        withQueryTimeout,
      );
    const table = (sql: string, params: ReadonlyArray<unknown>) =>
      collectTable(chunks(sql, params));
    const rows = (sql: string, params: ReadonlyArray<unknown>) =>
      chunks(sql, params).pipe(
        Stream.flatMap((table) => Stream.fromIterable(table)),
        Stream.map((row) => row.toJSON()),
      );
    const connection: Connection = {
      execute: (sql, params, transform) =>
        rows(sql, params).pipe(
          Stream.runCollect,
          Effect.map((rows) => (transform ? transform(rows) : rows)),
          withQueryTimeout,
        ),
      executeRaw: table,
      executeStream: (sql, params, transform) =>
        rows(sql, params).pipe(
          Stream.map((row) => (transform ? transform([row])[0] : row)),
        ),
      executeValues: (sql, params) =>
        chunks(sql, params).pipe(
          Stream.flatMap((table) => Stream.fromIterable(table)),
          // Arrow's iterator follows field order; toArray goes through Object.values.
          Stream.map((row) => Array.from(row, ([, value]) => value)),
          Stream.runCollect,
          withQueryTimeout,
        ),
      executeUnprepared: (sql, params, transform) =>
        connection.execute(sql, params, transform),
      executeValuesUnprepared: (sql, params) =>
        connection.executeValues(sql, params),
    };
    const compiler = makeCompiler();
    const spanAttributes: ReadonlyArray<readonly [string, unknown]> = [
      ["db.system.name", "databricks"],
      ["db.namespace", options.warehouseId],
    ];
    const client = yield* Client.make({
      acquirer: Effect.succeed(connection),
      compiler,
      driver: "databricks",
      spanAttributes,
      // Independent REST statements do not share a transaction/session.
      transactionAcquirer: Effect.fail(
        failure(
          "Transactions are not supported by this Databricks REST adapter",
          "transaction",
        ),
      ),
    });
    // Reuse Statement's execution boundary for transformers and client spans.
    // These connections change only the streaming result shape, not row queries
    // that a transformer might execute with the constructor it receives.
    const arrowSql = Object.assign(
      Statement.make(
        Effect.succeed({ ...connection, executeStream: chunks }),
        compiler,
        spanAttributes,
        undefined,
      ),
      sparkDialect,
    );
    const ipcSql = Object.assign(
      Statement.make(
        Effect.succeed({ ...connection, executeStream: ipc }),
        compiler,
        spanAttributes,
        undefined,
      ),
      sparkDialect,
    );
    const arrowChunks = (statement: Statement.Statement<unknown>) =>
      arrowSql<Table>`${statement}`.stream;
    return Object.assign(client, {
      ...sparkDialect,
      // There are no name or row transforms to remove. Keep the driver's APIs
      // and Spark dialect dispatch when generic consumers request this view.
      withoutTransforms: () => client,
      arrow: (statement: Statement.Statement<unknown>) =>
        collectTable(arrowChunks(statement)),
      arrowChunks,
      arrowStream: (statement: Statement.Statement<unknown>) =>
        arrowChunks(statement).pipe(
          Stream.flatMap((table) => Stream.fromIterable(table.batches)),
        ),
      ipcStream: (statement: Statement.Statement<unknown>) =>
        ipcSql<Uint8Array>`${statement}`.stream,
      withQueryTimeout,
      param: (type: string, value: string | null) =>
        Statement.fragment([
          Statement.parameter(new TypedParameter(type, value)),
        ]),
    });
  });

/** Provides both driver-specific and generic SQL services with shared client state. */
export const layer = (
  options: DatabricksClientConfig,
): Layer.Layer<DatabricksClient | Client.SqlClient, SqlError> =>
  Layer.effectContext(
    Effect.map(make(options), (client) =>
      Context.make(DatabricksClient, client).pipe(
        Context.add(Client.SqlClient, client),
      ),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
