import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { makeGenieClient, type GenieRequest } from "../src/index.js";

test("Genie results keep attachment order, contents, and all returned inline rows", async () => {
  const rows = Array.from({ length: 125 }, () => ["1", null]);
  const calls: GenieRequest[] = [];
  const client = makeGenieClient({
    spaceId: "test space",
    request: (request) =>
      Effect.sync(() => {
        calls.push(request);
        switch (request.kind) {
          case "submit":
            return {
              conversation_id: "conversation",
              message: { message_id: "message" },
            };
          case "message":
            return {
              conversation_id: "conversation",
              message_id: "message",
              status: "COMPLETED",
              attachments: [
                { text: { content: "Sample results" } },
                { attachment_id: "query", query: { query: "SELECT 1, NULL" } },
                { suggested_questions: { questions: ["Compare results?"] } },
                { attachment_id: "viz", viz: { query_attachment_id: "query" } },
              ],
            };
          case "query-result":
            return {
              statement_response: {
                manifest: {
                  total_row_count: 250,
                  schema: {
                    columns: [
                      { name: "one", type_name: "INT" },
                      { name: "empty" },
                    ],
                  },
                },
                result: { data_array: rows, next_chunk_index: 1 },
              },
            };
        }
      }),
  });

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const operation = yield* client.submit({
        content: "Show sample results",
      });
      const progress = yield* client.poll(operation);
      assert.equal(progress.state, "completed");
      return yield* client.result(operation);
    }),
  );
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["submit", "message", "message", "query-result"],
  );
  assert.deepEqual(calls[0], {
    kind: "submit",
    method: "POST",
    path: "/api/2.0/genie/spaces/test%20space/start-conversation",
    body: { content: "Show sample results" },
  });
  assert.deepEqual(result, {
    conversationId: "conversation",
    messageId: "message",
    attachments: [
      { kind: "text", content: "Sample results" },
      {
        kind: "query",
        attachmentId: "query",
        sql: "SELECT 1, NULL",
        columns: [{ name: "one", typeName: "INT" }, { name: "empty" }],
        rows,
        truncated: false,
        totalRowCount: 250,
        nextChunkIndex: 1,
      },
      {
        kind: "suggested-questions",
        payload: { questions: ["Compare results?"] },
      },
      {
        kind: "visualization",
        attachmentId: "viz",
        payload: { query_attachment_id: "query" },
      },
    ],
  });
});
