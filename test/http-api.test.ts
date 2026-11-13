import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpRouter,
  HttpServer,
} from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { api } from "../client/src/lib/api-client.js";
import { Analytics } from "../src/analytics.js";
import { AppApi } from "../src/api.js";
import type { Note, NoteInput } from "../src/domain.js";
import { Genie } from "../src/genie.js";
import { Notebook } from "../src/notebook.js";
import { Routes } from "../src/routes.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";

const operation = { conversationId: "conversation-1", messageId: "message-1" };
const note: NoteInput = {
  id: "472a6613-2337-4af1-a416-e9b6b61064dd",
  title: "Finding",
  body: "Fare analysis",
  filters: { from: "2016-01-01", zip: "10001" },
  version: null,
};
const metadata = { from: "2016-01-01", to: "2016-12-31", trips: 10 };
const overview = {
  summary: {
    trips: 10,
    revenue: 100,
    avg_fare: 10,
    avg_distance: 2,
    avg_duration: 5,
  },
  daily: [],
  hourly: [],
  zones: [],
  queriedAt: "2026-11-13T00:00:00Z",
};

const fixture = () => {
  const calls: Array<readonly [string, unknown]> = [];
  let notes: Note[] = [];
  const record = <A>(name: string, input: unknown, output: A) =>
    Effect.sync(() => {
      calls.push([name, input]);
      return output;
    });
  const app = HttpRouter.toWebHandler(
    Routes.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Workspace, {
            accessToken: Effect.succeed(Redacted.make("unused")),
            request: () => Effect.die("Unexpected workspace request"),
          }),
          Layer.succeed(Analytics, {
            availability: Effect.succeed("unconfigured" as const),
            metadata: Effect.succeed(metadata),
            overview: (input) => record("overview", input, overview),
            trips: (input) =>
              record("trips", input, {
                rows: [],
                total: 10,
                page: input.page ?? 1,
                pageSize: 50,
              }),
          }),
          Layer.succeed(Genie, {
            availability: Effect.succeed("unconfigured" as const),
            submit: (input) => record("submit", input, operation),
            poll: (input) =>
              record("poll", input, {
                ...operation,
                state: "completed" as const,
                status: "COMPLETED",
              }),
            result: (input) =>
              record("result", input, {
                ...operation,
                text: "Ten trips",
                queries: [],
              }),
          }),
          Layer.succeed(Notebook, {
            availability: Effect.succeed("unconfigured" as const),
            list: Effect.sync(() => notes),
            save: (input) =>
              Effect.sync(() => {
                calls.push(["save", input]);
                const saved = {
                  ...input,
                  version: (input.version ?? 0) + 1,
                  pinned: false,
                  created_at: "2026-11-13",
                  updated_at: "2026-11-13",
                };
                notes = [saved];
                return saved;
              }),
            pin: (id, input) =>
              record(
                "pin",
                { id, ...input },
                {
                  ...note,
                  version: input.version + 1,
                  pinned: input.pinned,
                  created_at: "2026-11-13",
                  updated_at: "2026-11-13",
                },
              ),
            remove: (id) =>
              Effect.sync(() => {
                calls.push(["remove", id]);
                notes = notes.filter((entry) => entry.id !== id);
              }),
          }),
          Settings.layer.pipe(
            Layer.provide(
              Layer.succeed(
                ConfigProvider.ConfigProvider,
                ConfigProvider.fromEnvRecord({}),
              ),
            ),
          ),
        ),
      ),
      Layer.provideMerge(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
  const fetch: typeof globalThis.fetch = (input, init) =>
    app.handler(new Request(input, init));
  const client = Effect.runSync(
    HttpApiClient.make(AppApi, { baseUrl: "http://localhost" }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    ),
  ).app;
  return { app, client, calls };
};

test("generated client round-trips every endpoint through the real HTTP contract", async (t) => {
  const { app, client, calls } = fixture();
  t.after(app.dispose);
  const filters = { from: "2016-01-01", to: "2016-02-01", zip: "10001" };
  await Effect.runPromise(
    Effect.gen(function* () {
      assert.deepEqual(yield* client.health(), { status: "ok" });
      assert.deepEqual(yield* client.status(), {
        dataset: "samples.nyctaxi.trips",
        warehouse: false,
        genie: false,
        lakebase: false,
        capabilities: {
          warehouse: "unconfigured",
          genie: "unconfigured",
          lakebase: "unconfigured",
        },
        auth: "Local development identity",
      });
      assert.equal(yield* client.currentUser(), null);
      assert.deepEqual(yield* client.metadata(), metadata);
      assert.deepEqual(yield* client.overview({ query: filters }), overview);
      assert.deepEqual(
        yield* client.trips({ query: { ...filters, page: 2, sort: "fare" } }),
        {
          rows: [],
          total: 10,
          page: 2,
          pageSize: 50,
        },
      );
      assert.deepEqual(
        yield* client.submitGenie({
          payload: { content: "Count trips", conversationId: "previous-1" },
        }),
        operation,
      );
      assert.deepEqual(yield* client.pollGenie({ params: operation }), {
        ...operation,
        state: "completed",
        status: "COMPLETED",
      });
      assert.deepEqual(yield* client.genieResult({ params: operation }), {
        ...operation,
        text: "Ten trips",
        queries: [],
      });
      const saved = yield* client.saveNote({ payload: note });
      assert.deepEqual(saved, {
        ...note,
        version: 1,
        pinned: false,
        created_at: "2026-11-13",
        updated_at: "2026-11-13",
      });
      assert.deepEqual(yield* client.notes(), [saved]);
      const pinned = yield* client.pinNote({
        params: { id: note.id },
        payload: { version: saved.version, pinned: true },
      });
      assert.equal(pinned.pinned, true);
      assert.equal(pinned.version, 2);
      assert.deepEqual(
        yield* client.removeNote({
          params: { id: note.id },
          query: { version: pinned.version },
        }),
        {
          deleted: true,
        },
      );
      assert.deepEqual(yield* client.notes(), []);
    }),
  );
  assert.deepEqual(calls, [
    ["overview", filters],
    ["trips", { ...filters, page: 2, sort: "fare" }],
    ["submit", { content: "Count trips", conversationId: "previous-1" }],
    ["poll", operation],
    ["result", operation],
    ["save", note],
    ["pin", { id: note.id, version: 1, pinned: true }],
    ["remove", note.id],
  ]);
});

test("invalid query, path and JSON inputs never reach services", async (t) => {
  const { app, calls } = fixture();
  t.after(app.dispose);
  for (const [path, init] of [
    ["/api/overview?zip=invalid", undefined],
    ["/api/overview?from=2016-02-01&to=2016-01-01", undefined],
    ["/api/trips?from=2016-02-01&to=2016-01-01", undefined],
    [
      "/api/notes",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...note,
          filters: { from: "2016-02-01", to: "2016-01-01" },
        }),
      },
    ],
    ...[
      { from: "2016-02-01", to: "2016-01-01" },
      { zip: "bad" },
      { to: "2016-02-30" },
    ].map(
      (filters) =>
        [
          "/api/genie",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "Count", filters }),
          },
        ] as const,
    ),
    ["/api/overview?from=2016-02-31", undefined],
    ["/api/trips?page=0", undefined],
    ["/api/trips?sort=unsafe", undefined],
    ["/api/genie/bad%20id/messages/message", undefined],
    ["/api/notes/bad-id", { method: "DELETE" }],
    [`/api/notes/${note.id}`, { method: "DELETE" }],
    [`/api/notes/${note.id}?version=0`, { method: "DELETE" }],
    [
      `/api/notes/${note.id}/pin`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      },
    ],
    [
      "/api/genie",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
    ],
    [
      "/api/genie",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"content":""}',
      },
    ],
    [
      "/api/notes",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...note, version: 0 }),
      },
    ],
  ] as const) {
    const response = await app.handler(
      new Request(`http://localhost${path}`, init),
    );
    assert.equal(response.status, 400, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: {
        code: "invalid_request",
        message: "Check the request fields, dates, and ZIP code.",
      },
    });
  }
  assert.deepEqual(calls, []);
});

test("generated client rejects reversed dates before sending a request", async (t) => {
  const { app, client, calls } = fixture();
  t.after(app.dispose);
  const result = await Effect.runPromise(
    Effect.result(
      client.overview({
        query: { from: "2016-02-01", to: "2016-01-01" },
      }),
    ),
  );
  assert.ok(result._tag === "Failure" && Schema.isSchemaError(result.failure));
  assert.deepEqual(calls, []);
});

test("generated client decodes declared server validation errors and the UI exposes their message", async (t) => {
  const { app } = fixture();
  t.after(app.dispose);
  const response = await app.handler(
    new Request("http://localhost/api/overview?from=2016-02-01&to=2016-01-01"),
  );
  assert.equal(response.status, 400);
  const client = Effect.runSync(
    HttpApiClient.make(AppApi, { baseUrl: "http://localhost" }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, async () =>
        response.clone(),
      ),
    ),
  ).app;
  const request = client.overview({ query: {} });
  const result = await Effect.runPromise(Effect.result(request));
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure")
    assert.deepEqual(result.failure, {
      error: {
        code: "invalid_request",
        message: "Check the request fields, dates, and ZIP code.",
      },
    });
  await assert.rejects(api(request), /Check the request fields/);
});

test("generated client rejects an unexpected success response", async () => {
  const client = Effect.runSync(
    HttpApiClient.make(AppApi, { baseUrl: "http://localhost" }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, async () =>
        Response.json({ trips: "wrong" }),
      ),
    ),
  ).app;
  const result = await Effect.runPromise(Effect.result(client.metadata()));
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure")
    assert.ok(Schema.isSchemaError(result.failure));
});

test("UI cancellation aborts a generated-client response body after headers arrive", {
  timeout: 5000,
}, async () => {
  let signal: AbortSignal | null | undefined;
  let bodyStarted!: () => void;
  const reading = new Promise<void>((resolve) => {
    bodyStarted = resolve;
  });
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    signal = init?.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          signal?.addEventListener(
            "abort",
            () => controller.error(new Error("aborted")),
            { once: true },
          );
          bodyStarted();
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  const client = Effect.runSync(
    Effect.gen(function* () {
      return yield* HttpApiClient.makeWith(AppApi, {
        baseUrl: "http://localhost",
        httpClient: HttpClient.withScope(yield* HttpClient.HttpClient),
      });
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    ),
  ).app;
  const controller = new AbortController();
  const pending = api(client.metadata(), controller.signal);
  const rejected = assert.rejects(pending);
  await reading;
  controller.abort();
  await rejected;
  assert.equal(signal?.aborted, true);
});
