import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Fiber, Latch, Redacted, Tracer } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { DatabricksClient } from "../src/index.js";

const statementsPath = "/api/2.0/sql/statements";
const statementId = "warehouse-statement";
const statusPath = `${statementsPath}/${statementId}`;
const cancelPath = `${statusPath}/cancel`;

for (const scenario of [
  {
    name: "cancels a known running statement when its submit payload is malformed",
    submit: { status: { state: "RUNNING" }, manifest: { format: 42 } },
    expectedRequests: [statementsPath, cancelPath],
    reason: "UnknownError",
    operation: "decode",
  },
  {
    name: "keeps a terminal poll state when its result payload is malformed",
    submit: { status: { state: "RUNNING" } },
    poll: () =>
      Response.json({
        statement_id: statementId,
        status: { state: "SUCCEEDED" },
        manifest: { format: 42 },
      }),
    expectedRequests: [statementsPath, statusPath],
    reason: "UnknownError",
    operation: "decode",
  },
  {
    name: "keeps the typed poll failure and its statement ID",
    submit: { status: { state: "RUNNING" } },
    poll: () => new Response(null, { status: 403 }),
    expectedRequests: [statementsPath, statusPath, cancelPath],
    reason: "AuthorizationError",
    operation: "poll",
  },
]) {
  test(scenario.name, async () => {
    const requests: string[] = [];
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const fetch: typeof globalThis.fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input)
        .pathname;
      requests.push(path);
      if (path === statementsPath)
        return Response.json({ statement_id: statementId, ...scenario.submit });
      if (path === statusPath && scenario.poll) return scenario.poll();
      if (path === cancelPath) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request ${path}`);
    };

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* DatabricksClient.DatabricksClient;
        return yield* Effect.flip(sql`SELECT 1`);
      }).pipe(
        Effect.provide(
          DatabricksClient.layer({
            host: "https://workspace.example",
            warehouseId: "warehouse",
            accessToken: Effect.succeed(Redacted.make("test-token")),
            pollInterval: "1 millis",
            fetch,
          }),
        ),
        Effect.withTracer(tracer),
      ),
    );

    assert.deepEqual(requests, scenario.expectedRequests);
    assert.equal(error.reason._tag, scenario.reason);
    assert.equal(error.reason.operation, scenario.operation);
    assert.deepEqual(error.reason.cause, { statementId });
    const querySpan = spans.find((span) => span.name === "databricks.query");
    assert.equal(
      querySpan?.attributes.get("databricks.statement.id"),
      statementId,
    );
  });
}

for (const shape of ["rows", "values", "arrow"] as const) {
  test(
    `keeps the statement ID when materializing ${shape} times out`,
    { timeout: 5000 },
    async () => {
      const polling = Latch.makeUnsafe();
      const requests: string[] = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : input)
          .pathname;
        requests.push(path);
        if (path === statementsPath)
          return Response.json({
            statement_id: statementId,
            status: { state: "RUNNING" },
          });
        if (path === statusPath) {
          polling.openUnsafe();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          });
        }
        if (path === cancelPath) return new Response(null, { status: 204 });
        throw new Error(`Unexpected request ${path}`);
      };

      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* DatabricksClient.DatabricksClient;
          const statement = sql`SELECT 1`;
          const queries = {
            rows: Effect.asVoid(statement),
            values: Effect.asVoid(statement.values),
            arrow: Effect.asVoid(sql.arrow(statement)),
          };
          const fiber = yield* Effect.flip(queries[shape]).pipe(
            Effect.forkChild,
          );
          yield* TestClock.adjust("1 millis");
          yield* polling.await;
          yield* TestClock.adjust("1 second");
          return yield* Fiber.join(fiber);
        }).pipe(
          Effect.provide(
            DatabricksClient.layer({
              host: "https://workspace.example",
              warehouseId: "warehouse",
              accessToken: Effect.succeed(Redacted.make("test-token")),
              pollInterval: "1 millis",
              queryTimeout: "1 second",
              fetch,
            }),
          ),
          Effect.provide(TestClock.layer()),
        ),
      );

      assert.deepEqual(requests, [statementsPath, statusPath, cancelPath]);
      assert.equal(error.reason.operation, "query");
      assert.deepEqual(error.reason.cause, {
        statementId,
        reason: "StatementTimeoutError",
      });
    },
  );
}
