import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, Effect, Exit, Fiber, Latch } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import * as TestClock from "effect/testing/TestClock";
import { AppApi } from "../../shared/api";
import { ApiClient, request } from "../src/lib/api-client";

for (const phase of ["headers", "body"] as const) {
  test(`client deadline aborts stalled ${phase} and permits a subsequent request`, async () => {
    const started = Latch.makeUnsafe();
    let signal: AbortSignal | null | undefined;
    let stalled = true;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      if (!stalled)
        return Response.json({
          from: "2016-01-01",
          to: "2016-02-29",
          trips: 1,
        });
      signal = init?.signal;
      if (phase === "headers")
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            {
              once: true,
            },
          );
          started.openUnsafe();
        });
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
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const call = () =>
          request((client) => client.metadata()).pipe(Effect.scoped);
        const pending = yield* call().pipe(Effect.forkChild);
        yield* started.await;
        yield* TestClock.adjust("119 seconds");
        assert.equal(signal?.aborted, false);
        yield* TestClock.adjust("1 second");
        const exit = yield* Fiber.await(pending);
        assert.ok(Exit.isFailure(exit));
        assert.ok(Cause.squash(exit.cause) instanceof Cause.TimeoutError);
        assert.equal(signal?.aborted, true);
        stalled = false;
        const result = yield* call();
        assert.equal(result.trips, 1);
      }).pipe(
        Effect.provideServiceEffect(
          ApiClient,
          Effect.gen(function* () {
            const httpClient = HttpClient.withScope(
              yield* HttpClient.HttpClient,
            );
            return (yield* HttpApiClient.makeWith(AppApi, {
              httpClient,
              baseUrl: "http://fixture.test",
            })).app;
          }).pipe(Effect.provide(FetchHttpClient.layer)),
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provide(TestClock.layer()),
      ),
    );
  });
}
