import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, Effect, Exit, Fiber, Latch, Redacted } from "effect";
import { SqlError } from "effect/sql/SqlError";
import * as TestClock from "effect/testing/TestClock";
import { Credentials, DatabricksClient } from "../src/index.js";
import { listen } from "./http.js";

for (const policy of ["workspace", "download", "oauth"] as const) {
  test(`${policy} transport rejects redirects without forwarding credentials`, async (t) => {
    let redirected = 0;
    const target = await listen(async (_req, res) => {
      redirected++;
      res.end("unexpected redirect");
    });
    t.after(target.close);
    const requests: Array<{ path: string; authorization: string | undefined }> =
      [];
    const server = await listen(async (req, res) => {
      requests.push({
        path: req.url ?? "",
        authorization: req.headers.authorization,
      });
      if (policy === "download" && req.url === "/api/2.0/sql/statements") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            statement_id: "statement",
            status: { state: "SUCCEEDED" },
            manifest: { format: "ARROW_STREAM", total_chunk_count: 1 },
            result: {
              external_links: [
                {
                  chunk_index: 0,
                  external_link: `${server.origin}/signed?signature=private-signature`,
                },
              ],
            },
          }),
        );
        return;
      }
      res.writeHead(307, { Location: `${target.origin}/redirected` });
      res.end();
    });
    t.after(server.close);
    const result = await Effect.runPromise(
      Effect.result(
        policy === "oauth"
          ? Credentials.clientCredentials({
              host: server.origin,
              clientId: "client",
              clientSecret: Redacted.make("private-secret"),
            })
          : Effect.gen(function* () {
              const sql = yield* DatabricksClient.DatabricksClient;
              yield* sql.arrow(sql`SELECT 1`);
            }).pipe(
              Effect.provide(
                DatabricksClient.layer({
                  host: server.origin,
                  warehouseId: "warehouse",
                  accessToken: Effect.succeed(Redacted.make("private-secret")),
                }),
              ),
            ),
      ),
    );
    assert.equal(result._tag, "Failure");
    assert.equal(redirected, 0);
    assert.equal(requests.length, policy === "download" ? 2 : 1);
    assert.equal(
      requests.at(-1)?.authorization,
      policy === "download"
        ? undefined
        : policy === "workspace"
          ? "Bearer private-secret"
          : `Basic ${Buffer.from("client:private-secret").toString("base64")}`,
    );
    if (result._tag === "Failure")
      assert.doesNotMatch(
        JSON.stringify(result.failure),
        /private-secret|private-signature/,
      );
  });
}

for (const stop of ["interruption", "deadline"] as const) {
  test(
    `OAuth ${stop} aborts the response body and releases refresh for retry`,
    {
      timeout: 5000,
    },
    async () => {
      let attempts = 0;
      let signal: AbortSignal | null | undefined;
      const started = Latch.makeUnsafe();
      const provider = Credentials.clientCredentials({
        host: "https://workspace.example",
        clientId: "client",
        clientSecret: Redacted.make("secret"),
        fetch: async (_input, init) => {
          attempts++;
          assert.equal(init?.credentials, "omit");
          assert.equal(init?.redirect, "error");
          if (attempts > 1)
            return Response.json({
              access_token: "fresh-token",
              token_type: "Bearer",
              expires_in: 3600,
            });
          signal = init?.signal;
          return new Response(
            new ReadableStream({
              start(controller) {
                signal?.addEventListener(
                  "abort",
                  () => controller.error(new Error("aborted")),
                  { once: true },
                );
                started.openUnsafe();
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        },
      });
      const exit = await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* provider.pipe(Effect.forkChild);
          yield* started.await;
          if (stop === "deadline") yield* TestClock.adjust("30 seconds");
          else yield* Fiber.interrupt(fiber);
          const exit = yield* Fiber.await(fiber);
          assert.equal(Redacted.value(yield* provider), "fresh-token");
          return exit;
        }).pipe(Effect.provide(TestClock.layer())),
      );
      assert.ok(Exit.isFailure(exit));
      if (stop === "interruption") assert.ok(Cause.hasInterrupts(exit.cause));
      else {
        const error = Cause.squash(exit.cause);
        assert.ok(error instanceof SqlError);
        assert.equal(error.reason._tag, "StatementTimeoutError");
      }
      assert.equal(signal?.aborted, true);
      assert.equal(attempts, 2);
    },
  );
}
