import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted } from "effect";
import { unavailable } from "../src/errors.js";
import { Lakebase } from "../src/lakebase.js";
import { pgPassword } from "../src/pg-credentials.js";
import { SavedViews } from "../src/saved-views.js";
import { Settings } from "../src/settings.js";
import { TripComments } from "../src/trip-comments.js";
import { Workspace } from "../src/workspace.js";

const endpoint = { status: { hosts: { host: "unused.invalid" } } };
const configured = {
  LAKEBASE_ENDPOINT: "projects/test/branches/main/endpoints/primary",
  PGUSER: "test",
  PGPASSWORD: "unused",
};
const databaseLayer = (
  request: typeof Workspace.Service.request,
  config: Record<string, string> = configured,
) =>
  Lakebase.layer.pipe(
    Layer.provide(
      Layer.succeed(Workspace, {
        authMode: "token",
        accessToken: Effect.succeed(Redacted.make("unused")),
        request,
      }),
    ),
    Layer.provide(Settings.layer),
    Layer.provide(
      Layer.succeed(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord(config),
      ),
    ),
  );

test("Lakebase lazily shares one scoped client across concurrent consumers", async () => {
  let discoveries = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Lakebase;
      assert.equal(discoveries, 0);
      assert.equal(yield* database.availability, "unknown");
      // Obtaining the SQL facade does not open a physical connection (pool min=0).
      const clients = yield* Effect.all(
        Array.from({ length: 4 }, () =>
          database.use((sql) => Effect.succeed(sql)),
        ),
        { concurrency: "unbounded" },
      );
      assert.equal(discoveries, 1);
      assert.ok(clients.every((sql) => sql === clients[0]));
      assert.equal(yield* database.availability, "available");
      assert.equal(
        yield* database.use((sql) => Effect.succeed(sql)),
        clients[0],
      );
      assert.equal(discoveries, 1);
    }).pipe(
      Effect.provide(
        databaseLayer(() =>
          Effect.sync(() => {
            discoveries++;
            return endpoint;
          }).pipe(Effect.delay("10 millis")),
        ),
      ),
      Effect.scoped,
    ),
  );
});

test("Lakebase retries discovery after an outage and shares the recovered client", async () => {
  let discoveries = 0;
  const diagnostic = unavailable("workspace", "Temporary discovery outage");
  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Lakebase;
      const failed = yield* Effect.exit(database.use(() => Effect.void));
      assert.ok(Exit.isFailure(failed));
      const error = Cause.findErrorOption(failed.cause);
      assert.ok(
        error._tag === "Some" && error.value._tag === "ServiceUnavailable",
      );
      assert.equal(error.value.cause, diagnostic);
      assert.equal(yield* database.availability, "unavailable");
      const client = yield* database.use((sql) => Effect.succeed(sql));
      assert.equal(yield* database.availability, "available");
      assert.equal(yield* database.use((sql) => Effect.succeed(sql)), client);
      assert.equal(discoveries, 2);
    }).pipe(
      Effect.provide(
        databaseLayer(() =>
          Effect.suspend(() => {
            discoveries++;
            return discoveries === 1
              ? Effect.fail(diagnostic)
              : Effect.succeed(endpoint);
          }),
        ),
      ),
      Effect.scoped,
    ),
  );
});

test("interrupted discovery leaves Lakebase retryable", async () => {
  let discoveries = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Lakebase;
      const cancelled = yield* Effect.exit(database.use(() => Effect.void));
      assert.ok(
        Exit.isFailure(cancelled) && Cause.hasInterruptsOnly(cancelled.cause),
      );
      assert.equal(yield* database.availability, "unknown");
      yield* database.use(() => Effect.void);
      assert.equal(yield* database.availability, "available");
      assert.equal(discoveries, 2);
    }).pipe(
      Effect.provide(
        databaseLayer(() =>
          Effect.suspend(() => {
            discoveries++;
            return discoveries === 1
              ? Effect.interrupt
              : Effect.succeed(endpoint);
          }),
        ),
      ),
      Effect.scoped,
    ),
  );
});

for (const [name, operation] of [
  [
    "saved views",
    Effect.flatMap(SavedViews, (views) => views.list({})).pipe(
      Effect.provide(SavedViews.layer),
      Effect.asVoid,
    ),
  ],
  [
    "trip comments",
    Effect.flatMap(TripComments, (comments) =>
      comments.list({ tripId: "test-trip" }),
    ).pipe(Effect.provide(TripComments.layer), Effect.asVoid),
  ],
] as const) {
  test(`${name} can be constructed independently with unconfigured Lakebase`, async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Lakebase;
        assert.equal(yield* database.availability, "unconfigured");
        return yield* Effect.exit(operation);
      }).pipe(
        Effect.provide(
          databaseLayer(() => Effect.die("Unexpected discovery"), {}),
        ),
        Effect.scoped,
      ),
    );
    assert.ok(Exit.isFailure(result));
    const error = Cause.findErrorOption(result.cause);
    assert.ok(
      error._tag === "Some" && error.value._tag === "ServiceUnavailable",
    );
    assert.equal(error.value.service, "lakebase");
  });
}

test("Lakebase restores credential failures before recording availability and preserves mixed causes", async () => {
  const credentialError = unavailable("lakebase", "Credential refresh failed");
  const sqlError = unavailable("lakebase", "SQL operation failed");
  const defect = new Error("Unexpected operation defect");
  const bridged = await Effect.runPromiseExit(
    pgPassword(Effect.fail(credentialError)),
  );
  assert.ok(Exit.isFailure(bridged));
  const compound = Cause.combine(
    bridged.cause,
    Cause.combine(
      Cause.fail(sqlError),
      Cause.combine(Cause.die(defect), Cause.interrupt(42)),
    ),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Lakebase;
      const failed = yield* Effect.exit(
        database.use(() => Effect.failCause(compound)),
      );
      assert.ok(Exit.isFailure(failed));
      assert.equal(failed.cause.reasons.length, 4);
      assert.deepEqual(
        failed.cause.reasons
          .filter(Cause.isFailReason)
          .map((reason) => reason.error),
        [credentialError, sqlError],
      );
      assert.ok(
        failed.cause.reasons.some(
          (reason) => Cause.isDieReason(reason) && reason.defect === defect,
        ),
      );
      assert.deepEqual(Cause.interruptors(failed.cause), new Set([42]));
      assert.equal(yield* database.availability, "unavailable");
      yield* database.use(() => Effect.void);
      assert.equal(yield* database.availability, "available");
    }).pipe(
      Effect.provide(databaseLayer(() => Effect.succeed(endpoint))),
      Effect.scoped,
    ),
  );
});

for (const [name, operation] of [
  ["ordinary defects", Effect.die(new Error("Unexpected operation defect"))],
  ["interruption", Effect.interrupt],
] as const) {
  test(`Lakebase preserves ${name} without recording an availability failure`, async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Lakebase;
        yield* database.use(() => Effect.void);
        const original = yield* Effect.exit(operation);
        const actual = yield* Effect.exit(database.use(() => operation));
        assert.ok(Exit.isFailure(original) && Exit.isFailure(actual));
        assert.deepEqual(actual.cause.reasons, original.cause.reasons);
        assert.equal(yield* database.availability, "available");
      }).pipe(
        Effect.provide(databaseLayer(() => Effect.succeed(endpoint))),
        Effect.scoped,
      ),
    );
  });
}
