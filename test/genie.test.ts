import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
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
      const first = yield* genie.ask({ content: "Count trips" });
      const second = yield* genie.ask({
        content: "Count again",
        conversationId: first.conversationId,
      });
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
        ConfigProvider.fromEnvRecord({ GENIE_SPACE_ID: "space" }),
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
