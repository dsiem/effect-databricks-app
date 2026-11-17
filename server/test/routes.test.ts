import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { Status } from "../../shared/domain.js";
import { Analytics } from "../src/analytics.js";
import {
  GenieFailed,
  OperationTimeout,
  SavedViewConflict,
  SavedViewNotFound,
  type ServiceError,
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

const appFor = (
  effect: Effect.Effect<never, ServiceError>,
  genie?: typeof Genie.Service,
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
          }),
          Layer.succeed(
            Genie,
            genie ?? {
              availability: Effect.succeed("unconfigured" as const),
              submit: () => effect,
              poll: () => effect,
              result: () => effect,
            },
          ),
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

const cases: ReadonlyArray<{
  error: ServiceError;
  status: number;
  code: string;
  upstreamStatus?: number;
}> = [
  {
    error: new SavedViewConflict({
      id: "id",
      message: "Reload the latest saved view",
    }),
    status: 409,
    code: "saved_view_conflict",
  },
  {
    error: unavailable(
      "lakebase",
      "Lakebase unavailable",
      new Error("private diagnostic"),
    ),
    status: 503,
    code: "lakebase_unavailable",
  },
  {
    error: new UpstreamError({
      service: "workspace",
      upstreamStatus: 403,
      message: "Permission denied",
      cause: new Error("private diagnostic"),
    }),
    status: 502,
    code: "workspace_request_failed",
    upstreamStatus: 403,
  },
  {
    error: new OperationTimeout({
      service: "genie",
      message: "Resume this answer",
    }),
    status: 504,
    code: "genie_timeout",
  },
  {
    error: new SavedViewNotFound({ id: "id", message: "Already removed" }),
    status: 404,
    code: "saved_view_not_found",
  },
  {
    error: new OperationTimeout({
      service: "warehouse",
      message: "Admission deadline expired",
    }),
    status: 504,
    code: "warehouse_timeout",
  },
  {
    error: new GenieFailed({ status: "FAILED", message: "Question failed" }),
    status: 409,
    code: "genie_message_unavailable",
  },
];
for (const { error, status, code, upstreamStatus } of cases) {
  test(`HTTP boundary maps ${error._tag} and keeps diagnostics off the wire`, async () => {
    const app = appFor(Effect.fail(error));
    try {
      const response = await app.handler(
        new Request("http://localhost/api/saved-views"),
      );
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: {
          code,
          message: error.message,
          ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
        },
      });
    } finally {
      await app.dispose();
    }
  });
}

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
  const app = appFor(Effect.fail(unavailable("unused", "Unused")), {
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
  const app = appFor(Effect.fail(unavailable("unused", "Unused")));
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
    availability: Effect.succeed("unavailable"),
    submit: () => failure,
    poll: () => failure,
    result: () => failure,
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
