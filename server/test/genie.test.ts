import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted } from "effect";
import { unavailable } from "../src/errors.js";
import { Genie } from "../src/genie.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";

test("Genie accepts ID-less text and visualization attachments and retains follow-up context", async () => {
  const calls: { path: string; method: string }[] = [];
  const message = {
    message_id: "message",
    conversation_id: "conversation",
    status: "COMPLETED",
    attachments: [
      { text: { content: "There are **21,932 trips**." } },
      {
        attachment_id: "query",
        query: {
          query: "SELECT COUNT(*) AS total_trips FROM samples.nyctaxi.trips",
          description: "Trip count",
        },
      },
      { suggested_questions: { questions: ["Top pickup areas?"] } },
      { attachment_id: "chart", viz: { query_attachment_id: "query" } },
    ],
  };
  const workspace = Layer.succeed(Workspace, {
    accessToken: Effect.succeed(Redacted.make("unused")),
    request: (path, method = "GET") => {
      calls.push({ path, method });
      return Effect.succeed(
        path.endsWith("query-result")
          ? {
              statement_response: {
                manifest: {
                  schema: { columns: [{ name: "total_trips" }] },
                  total_row_count: 1,
                  truncated: false,
                },
                result: { data_array: [["21932"]] },
              },
            }
          : path.endsWith("start-conversation")
            ? { conversation_id: "conversation", message }
            : message,
      );
    },
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const genie = yield* Genie;
      const operation = yield* genie.submit({ content: "Count trips" });
      assert.deepEqual(operation, {
        conversationId: "conversation",
        messageId: "message",
      });
      assert.equal(
        calls.length,
        1,
        "submission returns before polling or downloading results",
      );
      assert.equal((yield* genie.poll(operation)).state, "completed");
      const first = yield* genie.result(operation);
      const followup = yield* genie.submit({
        content: "Count again",
        conversationId: first.conversationId,
      });
      const second = yield* genie.result(followup);
      return { first, second };
    }).pipe(
      Effect.provide(
        Genie.layer.pipe(
          Layer.provide(workspace),
          Layer.provide(Settings.layer),
        ),
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          DATABRICKS_HOST: "https://workspace.invalid",
          GENIE_SPACE_ID: "space",
        }),
      ),
    ),
  );
  assert.equal(result.first.text, "There are **21,932 trips**.");
  assert.deepEqual(result.first.queries[0]?.rows, [["21932"]]);
  assert.equal(result.second.conversationId, result.first.conversationId);
  assert.equal(
    calls.filter((call) => call.path.endsWith("start-conversation")).length,
    1,
  );
  assert.ok(
    calls.some(
      (call) =>
        call.path.endsWith("/conversations/conversation/messages") &&
        call.method === "POST",
    ),
  );
});

const operation = { conversationId: "conversation", messageId: "message" };
const message = {
  conversation_id: operation.conversationId,
  message_id: operation.messageId,
  status: "COMPLETED",
  attachments: [
    {
      attachment_id: "query",
      query: { query: "SELECT 1", description: "One" },
    },
  ],
};
const provideGenie = (request: typeof Workspace.Service.request) =>
  Genie.layer.pipe(
    Layer.provide(
      Layer.succeed(Workspace, {
        accessToken: Effect.succeed(Redacted.make("unused")),
        request,
      }),
    ),
    Layer.provide(Settings.layer),
    Layer.provide(
      Layer.succeed(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          DATABRICKS_HOST: "https://workspace.invalid",
          GENIE_SPACE_ID: "space",
        }),
      ),
    ),
  );

test("a failed result download can be retried with the same IDs without another submission", async () => {
  let submissions = 0;
  let downloads = 0;
  const diagnostic = new Error("download failed");
  const layer = provideGenie((path, method = "GET") => {
    if (method === "POST") {
      submissions++;
      return Effect.succeed({ conversation_id: "conversation", message });
    }
    if (path.endsWith("query-result")) {
      downloads++;
      return downloads === 1
        ? Effect.fail(unavailable("workspace", "Download failed", diagnostic))
        : Effect.succeed({
            statement_response: {
              manifest: {
                schema: { columns: [{ name: "one" }] },
                total_row_count: 150,
              },
              result: { data_array: Array.from({ length: 125 }, () => ["1"]) },
            },
          });
    }
    return Effect.succeed(message);
  });
  const reply = await Effect.runPromise(
    Effect.gen(function* () {
      const genie = yield* Genie;
      const submitted = yield* genie.submit({ content: "One" });
      const failed = yield* genie.result(submitted).pipe(Effect.exit);
      assert.ok(Exit.isFailure(failed));
      const error = Cause.findErrorOption(failed.cause);
      assert.ok(
        error._tag === "Some" && error.value._tag === "ServiceUnavailable",
      );
      assert.equal(error.value.cause, diagnostic);
      return yield* genie.result(submitted);
    }).pipe(Effect.provide(layer)),
  );
  assert.equal(submissions, 1);
  assert.equal(downloads, 2);
  assert.equal(reply.messageId, "message");
  assert.equal(reply.queries[0]?.rows.length, 100);
  assert.equal(reply.queries[0]?.truncated, true);
});

for (const status of [
  "EXECUTING_QUERY",
  "FAILED",
  "CANCELLED",
  "QUERY_RESULT_EXPIRED",
]) {
  test(`Genie polling exposes ${status} without submitting or downloading`, async () => {
    const calls: string[] = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const genie = yield* Genie;
        const progress = yield* genie.poll(operation);
        const reply = yield* genie.result(operation).pipe(Effect.exit);
        return { progress, reply };
      }).pipe(
        Effect.provide(
          provideGenie((path, method = "GET") => {
            assert.equal(method, "GET");
            calls.push(path);
            return Effect.succeed({ ...message, status });
          }),
        ),
      ),
    );
    assert.equal(
      result.progress.state,
      status === "EXECUTING_QUERY" ? "pending" : "failed",
    );
    assert.equal(result.progress.status, status);
    assert.ok(Exit.isFailure(result.reply));
    const error = Cause.findErrorOption(result.reply.cause);
    assert.ok(error._tag === "Some" && error.value._tag === "GenieFailed");
    assert.equal(error.value.status, status);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((path) => path.endsWith("/messages/message")));
  });
}

test("Genie preserves invalid upstream response diagnostics", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(Genie, (genie) => genie.poll(operation)).pipe(
      Effect.provide(provideGenie(() => Effect.succeed({ unexpected: true }))),
    ),
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "UpstreamError");
  assert.ok(error.value.cause && typeof error.value.cause === "object");
  assert.equal(Reflect.get(error.value.cause, "_tag"), "SchemaError");
});

test("interrupted Genie reads remain interrupted and the same operation can be resumed", async () => {
  let reads = 0;
  const layer = provideGenie(() =>
    ++reads === 1 ? Effect.interrupt : Effect.succeed(message),
  );
  const progress = await Effect.runPromise(
    Effect.gen(function* () {
      const genie = yield* Genie;
      const interrupted = yield* genie.poll(operation).pipe(Effect.exit);
      assert.ok(Exit.isFailure(interrupted));
      assert.ok(Cause.hasInterruptsOnly(interrupted.cause));
      return yield* genie.poll(operation);
    }).pipe(Effect.provide(layer)),
  );
  assert.equal(progress.state, "completed");
  assert.equal(progress.messageId, operation.messageId);
});

test("accepted submission IDs and status polling do not depend on result attachment decoding", async () => {
  const payload = { ...message, attachments: [{ future_attachment: {} }] };
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const genie = yield* Genie;
      const accepted = yield* genie.submit({ content: "Question" });
      const followup = yield* genie.submit({
        content: "Follow-up",
        conversationId: accepted.conversationId,
      });
      const progress = yield* genie.poll(accepted);
      const downloaded = yield* genie.result(accepted).pipe(Effect.exit);
      return { accepted, followup, progress, downloaded };
    }).pipe(
      Effect.provide(
        provideGenie((path) =>
          Effect.succeed(
            path.endsWith("start-conversation")
              ? { conversation_id: "conversation", message: payload }
              : payload,
          ),
        ),
      ),
    ),
  );
  assert.deepEqual(result.accepted, operation);
  assert.deepEqual(result.followup, operation);
  assert.equal(result.progress.state, "completed");
  assert.ok(Exit.isFailure(result.downloaded));
  const error = Cause.findErrorOption(result.downloaded.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "UpstreamError");
});

test("Genie builds structured filter context server-side for initial and follow-up questions", async () => {
  const requests: { path: string; body: unknown }[] = [];
  const filters = { from: "2016-01-10", to: "2016-01-20", zip: "10001" };
  const context = {
    page: "overview" as const,
    title: "Trips by pickup hour",
    data: JSON.stringify({ hourly: [{ hour: 18, trips: 200 }] }),
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const genie = yield* Genie;
      yield* genie.submit({ content: "Count trips", filters, context });
      yield* genie.submit({
        content: "Count all trips",
        conversationId: "conversation",
        filters: {},
        context: { page: "map", title: "Pickup activity" },
      });
      yield* genie.submit({
        content: "One day",
        conversationId: "conversation",
        filters: { from: "2016-01-10", to: "2016-01-10" },
      });
      yield* genie.submit({
        content: "From this date",
        filters: { from: "2016-01-10" },
      });
      yield* genie.submit({
        content: "Through this date",
        filters: { to: "2016-01-20" },
      });
    }).pipe(
      Effect.provide(
        Genie.layer.pipe(
          Layer.provide(
            Layer.succeed(Workspace, {
              accessToken: Effect.succeed(Redacted.make("unused")),
              request: (path, _method, body) =>
                Effect.sync(() => {
                  requests.push({ path, body });
                  return path.endsWith("start-conversation")
                    ? {
                        conversation_id: "conversation",
                        message: { message_id: "message" },
                      }
                    : {
                        conversation_id: "conversation",
                        message_id: "message",
                      };
                }),
            }),
          ),
          Layer.provide(Settings.layer),
        ),
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          DATABRICKS_HOST: "https://workspace.invalid",
          GENIE_SPACE_ID: "space",
          TRIP_SNAPSHOT_TABLE: "custom.taxi.trips",
        }),
      ),
    ),
  );
  assert.equal(requests.length, 5);
  const first = requests[0];
  assert.ok(
    first?.body && typeof first.body === "object" && "content" in first.body,
  );
  assert.equal(first.path.endsWith("start-conversation"), true);
  assert.equal(typeof first.body.content, "string");
  const content = String(first.body.content);
  assert.ok(content.startsWith("Count trips\n"));
  assert.ok(content.includes(JSON.stringify(filters)));
  assert.match(content, /custom.taxi.trips/);
  assert.ok(content.includes(JSON.stringify(context)));
  const followup = requests[1];
  assert.ok(
    followup?.body &&
      typeof followup.body === "object" &&
      "content" in followup.body,
  );
  assert.ok(followup.path.endsWith("/conversations/conversation/messages"));
  assert.match(String(followup.body.content), /\n\{\}\n/);
  assert.ok(String(followup.body.content).includes('"page":"map"'));
  assert.ok(!String(followup.body.content).includes("Trips by pickup hour"));
  for (const [index, filters] of [
    [2, { from: "2016-01-10", to: "2016-01-10" }],
    [3, { from: "2016-01-10" }],
    [4, { to: "2016-01-20" }],
  ] as const) {
    const body = requests[index]?.body;
    assert.ok(body && typeof body === "object" && "content" in body);
    assert.ok(String(body.content).includes(JSON.stringify(filters)));
  }
});
