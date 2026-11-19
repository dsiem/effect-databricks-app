import {
  RecordBatchReader,
  type Schema as ArrowSchema,
  Table,
  util,
} from "apache-arrow";
import { Effect, Schema, Stream } from "effect";
import type { Connection } from "effect/sql/SqlConnection";
import type { SqlError } from "effect/sql/SqlError";
import type { DatabricksClientConfig } from "../DatabricksClient.js";
import {
  afterSubmission,
  failure,
  httpFailure,
  parameter,
  ResultChunk,
  StatementHandle,
  StatementResponse,
  UnsupportedSqlFragment,
  statementFailure,
  timeout,
} from "./protocol.js";
import { makeTransport } from "./transport.js";

const decode = <S extends Schema.Top>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => failure("Invalid Databricks API response", "decode")),
  );

const isRunning = ({ status }: StatementHandle) =>
  status.state === "PENDING" || status.state === "RUNNING";

export const makeExecution = (options: DatabricksClientConfig) =>
  Effect.gen(function* () {
    const { config, requestJson, download, withQueryTimeout } =
      yield* makeTransport(options);
    const ipcWithMetadata = (
      sql: string,
      params: ReadonlyArray<unknown>,
      maxBytes?: number,
    ) =>
      Stream.suspend(() => {
        let statementId: StatementHandle["statement_id"] | undefined;
        return Stream.unwrap(
          Effect.gen(function* () {
            if (
              maxBytes !== undefined &&
              (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
            )
              return yield* Effect.fail(
                failure(
                  "maxBytes must be a positive safe integer",
                  "configure",
                ),
              );
            const parameters = yield* Effect.try({
              try: () => params.map(parameter),
              catch: (cause) =>
                cause instanceof UnsupportedSqlFragment
                  ? failure(cause.message, "compile")
                  : failure(
                      "Unsupported SQL parameter; use sql.param for an explicit type",
                      "bind",
                    ),
            });
            const query = yield* Effect.acquireRelease(
              requestJson("/api/2.0/sql/statements", "submit", {
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
                ...(options.byteLimit === undefined && maxBytes === undefined
                  ? {}
                  : {
                      byte_limit: Math.min(
                        options.byteLimit ?? Infinity,
                        maxBytes ?? Infinity,
                      ),
                    }),
              }).pipe(
                Effect.flatMap((response) =>
                  decode(StatementHandle, response).pipe(
                    Effect.map((current) => ({ current, response })),
                  ),
                ),
              ),
              (query) =>
                Effect.suspend(() =>
                  isRunning(query.current)
                    ? requestJson(
                        `/api/2.0/sql/statements/${encodeURIComponent(query.current.statement_id)}/cancel`,
                        "cancel",
                      ).pipe(Effect.timeoutOption("5 seconds"), Effect.ignore)
                    : Effect.void,
                ),
              // A lost response is already an ambiguous outcome. Abort the request
              // promptly instead of shielding submission from the caller's deadline.
              { interruptible: true },
            );
            const id = query.current.statement_id;
            statementId = id;
            yield* Effect.annotateCurrentSpan("databricks.statement.id", id);
            const path = `/api/2.0/sql/statements/${encodeURIComponent(id)}`;
            let current = yield* decode(StatementResponse, query.response);
            while (isRunning(query.current)) {
              yield* Effect.sleep(config.poll);
              const response = yield* requestJson(path, "poll");
              const next = yield* decode(StatementHandle, response);
              if (next.statement_id !== id) {
                return yield* Effect.fail(
                  failure(
                    "Databricks returned a different statement ID",
                    "poll",
                  ),
                );
              }
              query.current = next;
              current = yield* decode(StatementResponse, response);
            }
            if (current.status.state !== "SUCCEEDED") {
              return yield* Effect.fail(statementFailure(current.status));
            }
            const manifest = current.manifest;
            if (manifest?.format !== "ARROW_STREAM" || manifest.truncated) {
              return yield* Effect.fail(
                failure(
                  "Expected complete, untruncated Arrow results",
                  "manifest",
                ),
              );
            }
            const first = current.result;
            const rowCounts = new Map(
              manifest.chunks?.map((chunk) => [
                chunk.chunk_index,
                chunk.row_count,
              ]),
            );
            const chunkLink = (index: number, cached?: ResultChunk) =>
              Effect.gen(function* () {
                const metadata =
                  cached ??
                  (yield* requestJson(
                    `${path}/result/chunks/${index}`,
                    "metadata",
                  ).pipe(
                    Effect.flatMap((value) => decode(ResultChunk, value)),
                  ));
                const link = metadata.external_links?.find(
                  (link) => link.chunk_index === index,
                );
                if (!link) {
                  return yield* Effect.fail(
                    failure("Missing Arrow result chunk", "metadata"),
                  );
                }
                return {
                  link,
                  rowCount:
                    rowCounts.get(index) ??
                    link.row_count ??
                    ((metadata.chunk_index ?? index) === index
                      ? metadata.row_count
                      : undefined),
                };
              });
            if (manifest.total_chunk_count === 0) {
              if (manifest.total_row_count) {
                return yield* Effect.fail(
                  failure(
                    "Missing Arrow chunks for a nonempty result",
                    "decodeArrow",
                  ),
                );
              }
              return Stream.empty;
            }
            let receivedBytes = 0;
            const lastIndex = manifest.total_chunk_count - 1;
            return Stream.range(0, lastIndex).pipe(
              Stream.mapEffect((index) =>
                Effect.gen(function* () {
                  const cached =
                    index === 0 &&
                    first?.external_links?.some(
                      (link) => link.chunk_index === 0,
                    )
                      ? first
                      : undefined;
                  let chunk = yield* chunkLink(index, cached);
                  const remaining =
                    maxBytes === undefined
                      ? undefined
                      : maxBytes - receivedBytes;
                  let result = yield* download(chunk.link, remaining);
                  // Signed URLs can expire while the downstream consumer is paused.
                  if (result.status === 401 || result.status === 403) {
                    const refreshed = yield* chunkLink(index);
                    result = yield* download(refreshed.link, remaining);
                    chunk = {
                      link: refreshed.link,
                      rowCount: refreshed.rowCount ?? chunk.rowCount,
                    };
                  }
                  if (result.status < 200 || result.status >= 300) {
                    return yield* Effect.fail(
                      httpFailure(result.status, "download"),
                    );
                  }
                  receivedBytes += result.bytes.byteLength;
                  return {
                    bytes: result.bytes,
                    expectedRowCount: chunk.rowCount,
                    expectedTotal:
                      index === lastIndex
                        ? manifest.total_row_count
                        : undefined,
                    statementId: id,
                  };
                }),
              ),
            );
          }),
        ).pipe(
          Stream.interruptWhen(
            Effect.sleep(config.query).pipe(
              Effect.andThen(Effect.fail(afterSubmission(timeout("query")))),
            ),
          ),
          Stream.mapError((error) =>
            statementId === undefined
              ? error
              : afterSubmission(error, statementId),
          ),
          Stream.withSpan("databricks.query"),
        );
      });

    const ipc = (
      sql: string,
      params: ReadonlyArray<unknown>,
      maxBytes?: number,
    ) =>
      ipcWithMetadata(sql, params, maxBytes).pipe(
        Stream.map(({ bytes }) => bytes),
      );
    const chunks = (sql: string, params: ReadonlyArray<unknown>) =>
      ipcWithMetadata(sql, params).pipe(
        Stream.mapAccumEffect(
          (): {
            readonly schema: ArrowSchema | undefined;
            readonly rows: number;
          } => ({ schema: undefined, rows: 0 }),
          (state, { bytes, expectedRowCount, expectedTotal, statementId }) =>
            Effect.gen(function* () {
              const table = yield* Effect.try({
                try: () => {
                  const reader = RecordBatchReader.from(bytes).open();
                  const schema = reader.schema;
                  if (!schema) throw new Error("Missing Arrow IPC schema");
                  return new Table(schema, [...reader]);
                },
                catch: () => failure("Invalid Arrow IPC result", "decodeArrow"),
              });
              if (
                expectedRowCount !== undefined &&
                table.numRows !== expectedRowCount
              )
                return yield* Effect.fail(
                  failure(
                    "Arrow chunk row count does not match result metadata",
                    "decodeArrow",
                  ),
                );
              if (
                state.schema &&
                !util.compareSchemas(state.schema, table.schema)
              )
                return yield* Effect.fail(
                  failure(
                    "Incompatible Arrow schemas across result chunks",
                    "decodeArrow",
                  ),
                );
              const rows = state.rows + table.numRows;
              if (expectedTotal !== undefined && rows !== expectedTotal) {
                return yield* Effect.fail(
                  failure(
                    "Arrow result row count does not match the manifest",
                    "decodeArrow",
                  ),
                );
              }
              return [
                { schema: state.schema ?? table.schema, rows },
                [table],
              ] as const;
            }).pipe(
              Effect.mapError((error) => afterSubmission(error, statementId)),
            ),
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
        ),
      executeUnprepared: (sql, params, transform) =>
        connection.execute(sql, params, transform),
      executeValuesUnprepared: (sql, params) =>
        connection.executeValues(sql, params),
    };
    return { connection, chunks, ipc, collectTable, withQueryTimeout };
  });
