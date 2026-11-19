import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Stream } from "effect";
import {
  makeGenieDownloadClient,
  type GenieDownloadRequest,
} from "../src/index.js";

const reference = {
  conversationId: "conversation",
  messageId: "message",
  attachmentId: "attachment",
};
const signedFirst =
  "https://first.s3.eu-west-1.amazonaws.com/result?signature=private";
const signedSecond =
  "https://storage.googleapis.com/bucket/second?signature=private";
const accepted = {
  download_id: "download",
  download_id_signature: "test + signature",
};

const prepared = (
  external_link: string,
  options: { truncated?: boolean; count?: number } = {},
) => ({
  statement_response: {
    statement_id: "statement",
    status: { state: "SUCCEEDED" },
    manifest: {
      format: "CSV",
      truncated: options.truncated ?? false,
      total_chunk_count: options.count ?? 2,
      schema: { columns: [{ name: "trip" }, { name: "count" }] },
    },
    result: { external_links: [{ chunk_index: 0, external_link }] },
  },
});

test("downloads every CSV chunk in order using scoped, credentialless storage requests", async () => {
  const calls: GenieDownloadRequest[] = [];
  const fetched: string[] = [];
  const client = makeGenieDownloadClient({
    spaceId: "space",
    request(request) {
      return Effect.sync(() => {
        calls.push(request);
        switch (request.kind) {
          case "start":
            return accepted;
          case "poll":
            return prepared(signedFirst);
          case "chunk":
            return {
              external_links: [
                {
                  chunk_index: 1,
                  external_link: signedSecond,
                  http_headers: {
                    "x-goog-project-id": "fixture",
                    Authorization: "private",
                    Cookie: "private",
                  },
                },
              ],
            };
        }
      });
    },
    fetch: async (input, options) => {
      assert.ok(input instanceof URL);
      fetched.push(input.href);
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      assert.deepEqual(
        options?.headers,
        input.href === signedFirst ? {} : { "x-goog-project-id": "fixture" },
      );
      return new Response(
        input.href === signedFirst ? "trip,count\r\nA,7" : "B,8\r\n",
      );
    },
  });

  const csv = await Effect.runPromise(
    client
      .download(reference)
      .pipe(
        Effect.flatMap((bytes) =>
          bytes.pipe(Stream.decodeText, Stream.runCollect),
        ),
      ),
  );

  const base =
    "/api/2.0/genie/spaces/space/conversations/conversation/messages/message/attachments/attachment/downloads";
  assert.deepEqual(calls, [
    { kind: "start", method: "POST", path: base },
    {
      kind: "poll",
      method: "GET",
      path: `${base}/download?download_id_signature=test+%2B+signature`,
    },
    {
      kind: "chunk",
      method: "GET",
      path: "/api/2.0/sql/statements/statement/result/chunks/1",
    },
  ]);
  assert.deepEqual(fetched, [signedFirst, signedSecond]);
  assert.equal(csv.join(""), "trip,count\r\nA,7\r\nB,8\r\n");
});

test("streams signed downloads from Databricks regional storage", async () => {
  const link =
    "https://us-east-2.storage.cloud.databricks.com/results?signature=private";
  const client = makeGenieDownloadClient({
    spaceId: "space",
    request: ({ kind }) =>
      Effect.succeed(
        kind === "start" ? accepted : prepared(link, { count: 1 }),
      ),
    fetch: async (url, init) => {
      assert.ok(url instanceof URL);
      assert.equal(url.href, link);
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      return new Response("trip,count\r\nA,7\r\n");
    },
  });
  const csv = await Effect.runPromise(
    client
      .download(reference)
      .pipe(
        Effect.flatMap((bytes) =>
          bytes.pipe(Stream.decodeText, Stream.runCollect),
        ),
      ),
  );
  assert.equal(csv.join(""), "trip,count\r\nA,7\r\n");
});

test("does not fetch an unrecognized URL or deliver a Databricks-truncated result", async () => {
  for (const [data, message] of [
    [
      prepared(
        "https://bucket.s3.amazonaws.com.attacker.invalid/?secret=private",
      ),
      /unrecognized CSV storage location/,
    ],
    [
      prepared(signedFirst, { truncated: true }),
      /Databricks truncated the CSV/,
    ],
  ] as const) {
    const client = makeGenieDownloadClient({
      spaceId: "space",
      request: ({ kind }) => Effect.succeed(kind === "start" ? accepted : data),
      fetch: async () => assert.fail("unexpected storage request"),
    });
    await assert.rejects(
      () =>
        Effect.runPromise(
          client.download(reference).pipe(Effect.flatMap(Stream.runDrain)),
        ),
      message,
    );
  }
});
