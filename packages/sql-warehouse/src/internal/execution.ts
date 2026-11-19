import { Table, tableFromIPC } from "apache-arrow";
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

export const makeExecution = (options: DatabricksClientConfig) =>
  Effect.gen(function* () {
    const { config, requestJson, download, withQueryTimeout } =
      yield* makeTransport(options);
    const ipc = (
      sql: string,
      params: ReadonlyArray<unknown>,
      maxBytes?: number,
    ): Stream.Stream<Uint8Array, SqlError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (
            maxBytes !== undefined &&
            (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
          )
            return yield* Effect.fail(
              failure("maxBytes must be a positive safe integer", "configure"),
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
              Effect.flatMap((value) => decode(StatementResponse, value)),
              Effect.map((current) => ({ current })),
            ),
            (query) =>
              Effect.suspend(() =>
                query.current.status.state === "PENDING" ||
                query.current.status.state === "RUNNING"
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
          const path = `/api/2.0/sql/statements/${encodeURIComponent(query.current.statement_id)}`;
          while (
            query.current.status.state === "PENDING" ||
            query.current.status.state === "RUNNING"
          ) {
            yield* Effect.sleep(config.poll);
            const next = yield* requestJson(path, "poll").pipe(
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
            return yield* Effect.fail(
              afterSubmission(statementFailure(query.current.status)),
            );
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
                  "metadata",
                ).pipe(Effect.flatMap((value) => decode(ResultChunk, value))));
              const link = metadata.external_links?.find(
                (link) => link.chunk_index === index,
              );
              if (!link) {
                return yield* Effect.fail(
                  failure("Missing Arrow result chunk", "metadata"),
                );
              }
              return link;
            });
          if (manifest.total_chunk_count === 0) return Stream.empty;
          let receivedBytes = 0;
          return Stream.range(0, manifest.total_chunk_count - 1).pipe(
            Stream.mapEffect((index) =>
              Effect.gen(function* () {
                const cached =
                  index === 0 &&
                  first?.external_links?.some((link) => link.chunk_index === 0)
                    ? first
                    : undefined;
                const link = yield* chunkLink(index, cached);
                const remaining =
                  maxBytes === undefined ? undefined : maxBytes - receivedBytes;
                let result = yield* download(link, remaining);
                // Signed URLs can expire while the downstream consumer is paused.
                if (result.status === 401 || result.status === 403) {
                  result = yield* download(yield* chunkLink(index), remaining);
                }
                if (result.status < 200 || result.status >= 300) {
                  return yield* Effect.fail(
                    afterSubmission(httpFailure(result.status, "download")),
                  );
                }
                receivedBytes += result.bytes.byteLength;
                return result.bytes;
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
    return { connection, chunks, ipc, collectTable, withQueryTimeout };
  });
