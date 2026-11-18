import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { OpenApi } from "effect/http-api";
import { AppApi } from "../../shared/api.js";
import { Status } from "../../shared/domain.js";
import { Analytics } from "../src/analytics.js";
import {
  GenieFailed,
  OperationTimeout,
  SavedViewConflict,
  SavedViewNotFound,
  type ServiceUnavailable,
  UpstreamError,
  unavailable,
} from "../src/errors.js";
import { Genie } from "../src/genie.js";
import { Lakebase } from "../src/lakebase.js";
import { Routes } from "../src/routes.js";
import { SavedViews } from "../src/saved-views.js";
import { Settings } from "../src/settings.js";
import { TripComments } from "../src/trip-comments.js";
import { Workspace } from "../src/workspace.js";

type Services = {
  genie?: Partial<typeof Genie.Service>;
  analytics?: Partial<typeof Analytics.Service>;
  savedViews?: Partial<typeof SavedViews.Service>;
};
const appFor = (
  effect: Effect.Effect<never, ServiceUnavailable> = Effect.die(
    "Unexpected service call",
  ),
  overrides: Services = {},
) =>
  HttpRouter.toWebHandler(
    Routes.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Workspace, {
            authMode: "token",
            accessToken: Effect.succeed(Redacted.make("unused")),
            request: () => Effect.die("Unexpected workspace request"),
          }),
          Layer.succeed(Analytics, {
            availability: Effect.succeed("unconfigured" as const),
            metadata: effect,
            overview: () => effect,
            trips: () => effect,
            tripMap: () => effect,
            analysisReport: () => effect,
            ...overrides.analytics,
          }),
          Layer.succeed(Genie, {
            availability: Effect.succeed("unconfigured" as const),
            submit: () => effect,
            poll: () => effect,
            result: () => effect,
            ...overrides.genie,
          }),
          Layer.succeed(Lakebase, {
            availability: Effect.succeed("unconfigured" as const),
            use: () => Effect.die("Unexpected database request"),
          }),
          Layer.succeed(TripComments, {
            counts: () => effect,
            list: () => effect,
            add: () => effect,
          }),
          Layer.succeed(SavedViews, {
            list: () => effect,
            save: () => effect,
            pin: () => effect,
            remove: () => effect,
            ...overrides.savedViews,
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

const removeView = new Request(
  "http://localhost/api/saved-views/00000000-0000-4000-8000-000000000001?version=1",
  { method: "DELETE" },
);
const getGenieResult = new Request(
  "http://localhost/api/genie/conversation/messages/message/result",
);
const conflict = new SavedViewConflict({
  id: "id",
  message: "Reload the latest saved view",
});
const missing = new SavedViewNotFound({ id: "id", message: "Already removed" });
const outage = unavailable(
  "lakebase",
  "Lakebase unavailable",
  new Error("private diagnostic"),
);
const denied = new UpstreamError({
  service: "workspace",
  upstreamStatus: 403,
  message: "Permission denied",
  cause: new Error("private diagnostic"),
});
const genieTimeout = new OperationTimeout({
  service: "genie",
  message: "Resume this answer",
});
const warehouseTimeout = new OperationTimeout({
  service: "warehouse",
  message: "Admission deadline expired",
});
const genieFailed = new GenieFailed({
  status: "FAILED",
  message: "Question failed",
});

for (const { request, services, status, error } of [
  {
    request: removeView,
    services: { savedViews: { remove: () => Effect.fail(conflict) } },
    status: 409,
    error: { code: "saved_view_conflict", message: conflict.message },
  },
  {
    request: removeView,
    services: { savedViews: { remove: () => Effect.fail(missing) } },
    status: 404,
    error: { code: "saved_view_not_found", message: missing.message },
  },
  {
    request: new Request("http://localhost/api/saved-views"),
    services: { savedViews: { list: () => Effect.fail(outage) } },
    status: 503,
    error: { code: "lakebase_unavailable", message: outage.message },
  },
  {
    request: getGenieResult,
    services: { genie: { result: () => Effect.fail(denied) } },
    status: 502,
    error: {
      code: "workspace_request_failed",
      message: denied.message,
      upstreamStatus: 403,
    },
  },
  {
    request: getGenieResult,
    services: { genie: { result: () => Effect.fail(genieTimeout) } },
    status: 504,
    error: { code: "genie_timeout", message: genieTimeout.message },
  },
  {
    request: getGenieResult,
    services: { genie: { result: () => Effect.fail(genieFailed) } },
    status: 409,
    error: { code: "genie_message_unavailable", message: genieFailed.message },
  },
  {
    request: new Request("http://localhost/api/overview"),
    services: { analytics: { overview: () => Effect.fail(warehouseTimeout) } },
    status: 504,
    error: { code: "warehouse_timeout", message: warehouseTimeout.message },
  },
] as const) {
  test(`HTTP maps ${error.code} on the operation that can produce it`, async (t) => {
    const app = appFor(undefined, services);
    t.after(app.dispose);
    const response = await app.handler(request);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error });
  });
}

test("endpoints advertise their applicable failures", () => {
  const { paths } = OpenApi.fromApi(AppApi);
  assert.deepEqual(Object.keys(paths["/health"]?.get?.responses ?? {}), [
    "200",
  ]);
  assert.deepEqual(Object.keys(paths["/api/overview"]?.get?.responses ?? {}), [
    "200",
    "400",
    "503",
    "504",
  ]);
  assert.deepEqual(
    Object.keys(paths["/api/saved-views"]?.get?.responses ?? {}),
    ["200", "400", "503"],
  );
  assert.deepEqual(
    Object.keys(paths["/api/saved-views"]?.put?.responses ?? {}),
    ["200", "400", "404", "409", "503"],
  );
});

test("Genie recovery endpoints validate operation IDs before calling the service", async () => {
  let calls = 0;
  const app = appFor(
    Effect.suspend(() => {
      calls++;
      return Effect.fail(unavailable("genie", "Unavailable"));
    }),
  );
  try {
    for (const path of [
      "/api/genie/bad%20id/messages/message",
      "/api/genie/conversation/messages/bad%20id/result",
    ]) {
      const response = await app.handler(
        new Request(`http://localhost${path}`),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: {
          code: "invalid_request",
          message: "Check the request fields, dates, and ZIP code.",
        },
      });
    }
    assert.equal(calls, 0);
    for (const path of [
      "/api/genie/conversation/messages/message",
      "/api/genie/conversation/messages/message/result",
    ]) {
      assert.equal(
        (await app.handler(new Request(`http://localhost${path}`))).status,
        503,
      );
    }
    assert.equal(calls, 2);
  } finally {
    await app.dispose();
  }
});

test("unexpected defects are HTTP 500 instead of dependency failures", async () => {
  const app = appFor(Effect.die(new Error("private programming error")));
  try {
    const response = await app.handler(
      new Request("http://localhost/api/saved-views"),
    );
    assert.equal(response.status, 500);
    assert.doesNotMatch(
      await response.text(),
      /private programming error|lakebase_unavailable/,
    );
  } finally {
    await app.dispose();
  }
});

test("HTTP separates submission IDs from polling and result retrieval", async () => {
  const operation = { conversationId: "conversation", messageId: "message" };
  const calls: unknown[] = [];
  const app = appFor(undefined, {
    genie: {
      availability: Effect.succeed("unknown" as const),
      submit: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return operation;
        }),
      poll: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return { ...input, state: "completed" as const, status: "COMPLETED" };
        }),
      result: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return { ...input, text: "Answer", queries: [] };
        }),
    },
  });
  try {
    const submitted = await app.handler(
      new Request("http://localhost/api/genie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Count trips" }),
      }),
    );
    assert.equal(submitted.status, 200);
    assert.deepEqual(await submitted.json(), operation);
    assert.deepEqual(calls, [{ content: "Count trips" }]);
    const progress = await app.handler(
      new Request("http://localhost/api/genie/conversation/messages/message"),
    );
    assert.deepEqual(await progress.json(), {
      ...operation,
      state: "completed",
      status: "COMPLETED",
    });
    const result = await app.handler(
      new Request(
        "http://localhost/api/genie/conversation/messages/message/result",
      ),
    );
    assert.deepEqual(await result.json(), {
      ...operation,
      text: "Answer",
      queries: [],
    });
    assert.deepEqual(calls, [{ content: "Count trips" }, operation, operation]);
  } finally {
    await app.dispose();
  }
});

test("current-user endpoint returns only each viewer's name/email and prevents caching", async () => {
  const app = appFor();
  try {
    for (const name of ["Avery Morgan", "Sam Rivera"]) {
      const response = await app.handler(
        new Request("http://localhost/api/me", {
          headers: {
            "X-Forwarded-Preferred-Username": name,
            "X-Forwarded-Email": "viewer@example.com",
            "X-Forwarded-User": "opaque-id",
            "X-Forwarded-Access-Token": "private-token",
          },
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        name,
        email: "viewer@example.com",
      });
    }
  } finally {
    await app.dispose();
  }
});

test("a configured Genie remains configured after an observed outage", async () => {
  const failure = Effect.fail(unavailable("genie", "Temporarily unavailable"));
  const app = appFor(failure, {
    genie: {
      availability: Effect.succeed("unavailable"),
      submit: () => failure,
      poll: () => failure,
      result: () => failure,
    },
  });
  try {
    const response = await app.handler(
      new Request("http://localhost/api/status"),
    );
    const status = Schema.decodeUnknownSync(Status)(await response.json());
    assert.equal(status.genie, true);
    assert.equal(status.capabilities.genie, "unavailable");
  } finally {
    await app.dispose();
  }
});
