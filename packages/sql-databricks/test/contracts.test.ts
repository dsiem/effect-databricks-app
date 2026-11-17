import assert from "node:assert/strict";
import { test } from "node:test";
import { Int64, Table, tableToIPC, vectorFromArray } from "apache-arrow";
import { Effect, Fiber, Latch, Redacted, Schema, Stream } from "effect";
import type { SqlError } from "effect/sql/SqlError";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as Statement from "effect/sql/Statement";
import * as TestClock from "effect/testing/TestClock";
import { DatabricksClient } from "../src/index.js";
import { parseUrl } from "../src/internal/protocol.js";

test("the managed storage exception keeps other HTTP locations and unsafe URLs rejected", () => {
  assert.throws(() => parseUrl("http://storage-proxy.databricks.com/result"));
  assert.equal(
    parseUrl("http://storage-proxy.databricks.com/result", true).hostname,
    "storage-proxy.databricks.com",
  );
  for (const url of [
    "http://storage-proxy.databricks.com.evil.example/result",
    "http://untrusted.example/result",
    "http://secret@storage-proxy.databricks.com/result",
    "http://storage-proxy.databricks.com:8080/result",
    "http://storage-proxy.databricks.com/result#secret",
  ])
    assert.throws(() => parseUrl(url, true));
});

const clientLayer = (fetch: typeof globalThis.fetch) =>
  DatabricksClient.layer({
    host: "https://workspace.example",
    warehouseId: "warehouse",
    accessToken: Effect.succeed(Redacted.make("test-token")),
    queryTimeout: "1 second",
    requestTimeout: "10 seconds",
    fetch,
  });

const fixture = () => {
  const submitted: Array<{ statement: string; parameters: unknown }> = [];
  const bytes = tableToIPC(
    new Table({ id: vectorFromArray([9007199254740993n], new Int64()) }),
    "stream",
  );
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://storage.example"))
      return new Response(bytes);
    submitted.push(JSON.parse(String(init?.body)));
    return Response.json({
      statement_id: "statement",
      status: { state: "SUCCEEDED" },
      manifest: { format: "ARROW_STREAM", total_chunk_count: 1 },
      result: {
        external_links: [
          { chunk_index: 0, external_link: "https://storage.example/0" },
        ],
      },
    });
  };
  return { fetch, submitted };
};

test("the query deadline aborts an in-flight submission without replaying SQL", {
  timeout: 5000,
}, async () => {
  const started = Latch.makeUnsafe();
  let submissions = 0;
  let aborted = false;
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    submissions++;
    started.openUnsafe();
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    });
  };
  const { result, abortedAtDeadline } = await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* DatabricksClient.DatabricksClient;
      const fiber = yield* sql
        .ipcStream(sql`SELECT 1`)
        .pipe(Stream.runDrain, Effect.result, Effect.forkChild);
      yield* started.await;
      yield* TestClock.adjust("1 second");
      const abortedAtDeadline = aborted;
      // Also release a broken implementation via its independent request timeout.
      yield* TestClock.adjust("9 seconds");
      return { result: yield* Fiber.join(fiber), abortedAtDeadline };
    }).pipe(
      Effect.provide(clientLayer(fetch)),
      Effect.provide(TestClock.layer()),
    ),
  );
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure") {
    assert.equal(result.failure.reason._tag, "StatementTimeoutError");
    assert.equal(result.failure.reason.operation, "query");
  }
  assert.equal(aborted, true);
  assert.equal(abortedAtDeadline, true);
  assert.equal(submissions, 1);
});

test("all native Arrow APIs apply the statement transformer and SQL tracing", async () => {
  const server = fixture();
  const spans: Parameters<Statement.Transformer>[3][] = [];
  const transformer: Statement.Transformer = (
    _statement,
    sql,
    _fiber,
    span,
  ) => {
    assert.equal(
      sql.onDialectOrElse({ mysql: () => "mysql", orElse: () => "spark" }),
      "spark",
    );
    spans.push(span);
    return Effect.succeed(
      sql.unsafe("SELECT :p1 AS id /* transformed */", [7]),
    );
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* DatabricksClient.DatabricksClient;
      const statement = sql`SELECT ${1} AS id`;
      yield* statement;
      yield* sql.arrow(statement);
      yield* Stream.runCollect(sql.arrowChunks(statement));
      yield* Stream.runCollect(sql.arrowStream(statement));
      yield* Stream.runCollect(sql.ipcStream(statement));
    }).pipe(
      Effect.provideService(Statement.CurrentTransformer, transformer),
      Effect.provide(clientLayer(server.fetch)),
    ),
  );
  assert.equal(server.submitted.length, 5);
  for (const { statement, parameters } of server.submitted) {
    assert.equal(statement, "SELECT :p1 AS id /* transformed */");
    assert.deepEqual(parameters, [{ name: "p1", type: "BIGINT", value: "7" }]);
  }
  assert.equal(spans.length, 5);
  for (const span of spans) {
    assert.equal(span.kind, "client");
    assert.equal(span.attributes.get("db.system.name"), "databricks");
    assert.equal(
      span.attributes.get("db.query.text"),
      "SELECT :p1 AS id /* transformed */",
    );
  }
});

for (const shape of [
  "arrowChunks",
  "arrowStream",
  "ipcStream",
  "rows",
] as const) {
  test(`withQueryTimeout interrupts downstream consumption of ${shape}`, async () => {
    const server = fixture();
    let consumerReleased = false;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* DatabricksClient.DatabricksClient;
        const consuming = yield* Latch.make();
        const statement = sql`SELECT 1 AS id`;
        const stream: Stream.Stream<unknown, SqlError> =
          shape === "rows" ? statement.stream : sql[shape](statement);
        const fiber = yield* stream.pipe(
          Stream.runForEach(() =>
            consuming.open.pipe(Effect.andThen(Effect.never)),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              consumerReleased = true;
            }),
          ),
          sql.withQueryTimeout,
          Effect.result,
          Effect.forkChild,
        );
        yield* consuming.await;
        yield* TestClock.adjust("1 second");
        return yield* Fiber.join(fiber);
      }).pipe(
        Effect.provide(clientLayer(server.fetch)),
        Effect.provide(TestClock.layer()),
      ),
    );
    assert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.equal(result.failure.reason._tag, "StatementTimeoutError");
      assert.equal(result.failure.reason.operation, "query");
    }
    assert.equal(consumerReleased, true);
    assert.equal(server.submitted.length, 1);
  });
}

test("SqlSchema validates decoded rows without losing BIGINT precision", async () => {
  const server = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* DatabricksClient.DatabricksClient;
      const execute = (id: bigint) => sql`SELECT ${id} AS id`;
      const find = SqlSchema.findAll({
        Request: Schema.BigInt,
        Result: Schema.Struct({ id: Schema.BigInt }),
        execute,
      });
      assert.deepEqual(yield* find(9007199254740993n), [
        { id: 9007199254740993n },
      ]);
      const invalid = SqlSchema.findAll({
        Request: Schema.BigInt,
        Result: Schema.Struct({ id: Schema.Number }),
        execute,
      });
      const result = yield* Effect.result(invalid(9007199254740993n));
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.equal(result.failure._tag, "SchemaError");
    }).pipe(Effect.provide(clientLayer(server.fetch))),
  );
  assert.equal(server.submitted.length, 2);
});

test("dialect dispatch never selects MySQL for Spark SQL", async () => {
  const server = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* DatabricksClient.DatabricksClient;
      for (const client of [sql, sql.safe, sql.withoutTransforms()]) {
        assert.equal(
          client.onDialectOrElse({
            mysql: () => "mysql",
            orElse: () => "spark",
          }),
          "spark",
        );
        assert.throws(() =>
          client.onDialect({
            sqlite: () => "sqlite",
            pg: () => "pg",
            mysql: () => "mysql",
            mssql: () => "mssql",
            clickhouse: () => "clickhouse",
          }),
        );
      }
    }).pipe(Effect.provide(clientLayer(server.fetch))),
  );
  assert.equal(server.submitted.length, 0);
});

test("bounded IPC cancels an overflowing response even if the warehouse ignores byte_limit", {
  timeout: 5000,
}, async () => {
  let cancelled = false;
  const fetch: typeof globalThis.fetch = async (input) => {
    if (String(input).startsWith("https://storage.example")) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(64));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    }
    return Response.json({
      statement_id: "statement",
      status: { state: "SUCCEEDED" },
      manifest: { format: "ARROW_STREAM", total_chunk_count: 1 },
      result: {
        external_links: [
          { chunk_index: 0, external_link: "https://storage.example/0" },
        ],
      },
    });
  };
  await assert.rejects(
    Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* DatabricksClient.DatabricksClient;
        return yield* Stream.runCollect(
          sql.ipcStream(sql`SELECT 1`, { maxBytes: 32 }),
        );
      }).pipe(Effect.provide(clientLayer(fetch))),
    ),
  );
  assert.equal(cancelled, true);
});
