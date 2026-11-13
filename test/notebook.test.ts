import assert from "node:assert/strict";
import { test } from "node:test";
import { PgClient } from "@effect/sql-pg";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Redacted,
  Stream,
} from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";
import type { Connection } from "effect/sql/SqlConnection";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import { type ServiceError, UpstreamError } from "../src/errors.js";
import { makeNotebook, migrateNotebook, Notebook } from "../src/notebook.js";
import { pgPassword, restoreCredentialFailure } from "../src/pg-credentials.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";
import { notebookFixture } from "./notebook-fixture.js";

const input = {
  id: "1b7f2115-e891-46a7-a3ad-c26405b2f5a2",
  title: "A note",
  body: "",
  filters: {},
  version: null,
};
const operations: Record<
  string,
  (
    notebook: Pick<typeof Notebook.Service, "list" | "save" | "pin" | "remove">,
  ) => Effect.Effect<unknown, ServiceError>
> = {
  list: (
    notebook: Pick<typeof Notebook.Service, "list" | "save" | "pin" | "remove">,
  ) => notebook.list,
  save: (
    notebook: Pick<typeof Notebook.Service, "list" | "save" | "pin" | "remove">,
  ) => notebook.save(input),
  pin: (notebook) => notebook.pin(input.id, { version: 1, pinned: true }),
  remove: (
    notebook: Pick<typeof Notebook.Service, "list" | "save" | "pin" | "remove">,
  ) => notebook.remove(input.id, 1),
};
const runNotebook = <A, E>(
  credentials: Effect.Effect<unknown, ServiceError>,
  use: (
    notebook: Pick<typeof Notebook.Service, "list" | "save" | "pin" | "remove">,
  ) => Effect.Effect<A, E>,
) =>
  Effect.runPromiseExit(
    Effect.flatMap(Notebook, use).pipe(
      Effect.provide(
        Notebook.layer.pipe(
          Layer.provide(
            Layer.succeed(Workspace, {
              accessToken: Effect.succeed(Redacted.make("unused")),
              request: () => credentials,
            }),
          ),
          Layer.provide(Settings.layer),
        ),
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          PGHOST: "unused.invalid",
          PGUSER: "test",
          LAKEBASE_ENDPOINT: "endpoint",
        }),
      ),
      Effect.scoped,
    ),
  );

for (const [name, operation] of Object.entries(operations)) {
  test(`notebook ${name} preserves credential diagnostics as a typed service failure`, async () => {
    const original = new Error("credential diagnostic");
    const upstream = new UpstreamError({
      service: "workspace",
      message: "Authentication failed",
      cause: original,
    });
    const exit = await runNotebook(Effect.fail(upstream), operation);
    assert.ok(Exit.isFailure(exit));
    const error = Cause.findErrorOption(exit.cause);
    assert.equal(error._tag, "Some");
    if (error._tag === "Some") {
      assert.equal(error.value._tag, "ServiceUnavailable");
      assert.ok("cause" in error.value);
      assert.equal(error.value.cause, upstream);
    }
    assert.equal(Cause.hasDies(exit.cause), false);
  });

  test(`notebook ${name} preserves unexpected defects`, async () => {
    const defect = new Error("programming error");
    const exit = await runNotebook(Effect.die(defect), operation);
    assert.ok(Exit.isFailure(exit));
    assert.ok(
      exit.cause.reasons.some(
        (reason) => Cause.isDieReason(reason) && reason.defect === defect,
      ),
    );
    assert.equal(Cause.hasFails(exit.cause), false);
  });

  test(`notebook ${name} preserves interruption`, async () => {
    const exit = await runNotebook(Effect.interrupt, operation);
    assert.ok(Exit.isFailure(exit));
    assert.ok(Cause.hasInterruptsOnly(exit.cause));
  });
}

test("invalid Lakebase credential payload is a typed error with its schema diagnostic", async () => {
  const exit = await runNotebook(
    Effect.succeed({ token: 42 }),
    (notebook) => notebook.list,
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.equal(error._tag, "Some");
  if (error._tag === "Some" && error.value._tag === "ServiceUnavailable") {
    assert.ok(error.value.cause && typeof error.value.cause === "object");
    assert.equal(Reflect.get(error.value.cause, "_tag"), "SchemaError");
  } else assert.fail("Expected a typed Lakebase failure");
});

const withRows = <A, E>(
  rows: Effect.Effect<ReadonlyArray<unknown>, SqlError>,
  use: (
    notebook: Pick<typeof Notebook.Service, "list" | "save" | "pin" | "remove">,
  ) => Effect.Effect<A, E>,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const connection: Connection = {
        execute: () => rows,
        executeUnprepared: () => rows,
        executeRaw: () => rows,
        executeStream: () => Stream.die("Unused stream"),
        executeValues: () => Effect.succeed([]),
        executeValuesUnprepared: () => Effect.succeed([]),
      };
      const sql = yield* SqlClient.make({
        driver: "pg",
        spanAttributes: [],
        compiler: PgClient.makeCompiler(),
        acquirer: Effect.succeed(connection),
      });
      return yield* use(
        makeNotebook(
          Object.assign(sql, {
            json: (value: unknown) => sql`${JSON.stringify(value)}`,
          }),
          "Lakebase unavailable",
        ),
      );
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );

test("notebook maps SQL failures without losing the original cause", async () => {
  const sqlError = new SqlError({
    reason: new UnknownError({
      cause: new Error("database diagnostic"),
      message: "Database failed",
      operation: "execute",
    }),
  });
  const exit = await withRows(
    Effect.fail(sqlError),
    (notebook) => notebook.list,
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "ServiceUnavailable");
  assert.equal(error.value.cause, sqlError);
});

test("notebook preserves row decoding diagnostics", async () => {
  const exit = await withRows(
    Effect.succeed([{ id: "invalid" }]),
    (notebook) => notebook.list,
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "ServiceUnavailable");
  assert.equal(Reflect.get(error.value.cause as object, "_tag"), "SchemaError");
});

test("removing a missing note keeps its distinct not-found error", async () => {
  const exit = await withRows(Effect.succeed([]), (notebook) =>
    notebook.remove(input.id, 1),
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "NoteNotFound");
  assert.equal(error.value.id, input.id);
});

test("the credential adapter preserves every reason in a mixed cause", async () => {
  const credentialError = new UpstreamError({
    service: "workspace",
    message: "Credential failure",
  });
  const bridged = await Effect.runPromiseExit(
    pgPassword(Effect.fail(credentialError)),
  );
  assert.ok(Exit.isFailure(bridged));
  const defect = new Error("unexpected defect");
  const compound = Cause.combine(
    bridged.cause,
    Cause.combine(Cause.die(defect), Cause.interrupt(42)),
  );
  const exit = await Effect.runPromiseExit(
    restoreCredentialFailure(Effect.failCause(compound)),
  );
  assert.ok(Exit.isFailure(exit));
  assert.equal(exit.cause.reasons.length, 3);
  assert.ok(
    exit.cause.reasons.some(
      (reason) =>
        Cause.isFailReason(reason) && reason.error === credentialError,
    ),
  );
  assert.ok(
    exit.cause.reasons.some(
      (reason) => Cause.isDieReason(reason) && reason.defect === defect,
    ),
  );
  assert.deepEqual(Cause.interruptors(exit.cause), new Set([42]));
});

test("versioned notebook writes reject stale editors, pin conflicts, and deleted-note resurrection", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { notebook, sql } = yield* notebookFixture;
      // Migrations are repeatable and existing rows keep their content/version.
      const created = yield* notebook.save(input);
      yield* sql`ALTER TABLE metrocab.notes DROP COLUMN version`;
      yield* migrateNotebook(sql);
      yield* migrateNotebook(sql);
      assert.equal((yield* notebook.list)[0]?.title, input.title);
      assert.equal(created.version, 1);
      assert.equal(created.pinned, false);
      const duplicate = yield* Effect.result(
        notebook.save({ ...input, title: "Duplicate" }),
      );
      assert.ok(
        duplicate._tag === "Failure" &&
          duplicate.failure._tag === "NoteConflict",
      );

      const edits = yield* Effect.all(
        [
          notebook
            .save({ ...created, title: "First editor" })
            .pipe(Effect.result),
          notebook
            .save({ ...created, title: "Second editor" })
            .pipe(Effect.result),
        ],
        { concurrency: 2 },
      );
      const successes = edits.filter((edit) => edit._tag === "Success");
      assert.equal(successes.length, 1);
      const failure = edits.find((edit) => edit._tag === "Failure");
      assert.ok(
        failure?._tag === "Failure" && failure.failure._tag === "NoteConflict",
      );
      const current = (yield* notebook.list)[0];
      assert.ok(current);
      assert.equal(current.version, 2);
      assert.equal(current.title, successes[0]?.success.title);

      const stalePin = yield* Effect.result(
        notebook.pin(created.id, { version: 1, pinned: true }),
      );
      assert.ok(
        stalePin._tag === "Failure" && stalePin.failure._tag === "NoteConflict",
      );
      const pinned = yield* notebook.pin(current.id, {
        version: current.version,
        pinned: true,
      });
      assert.equal(pinned.title, current.title);
      assert.equal(pinned.body, current.body);
      assert.deepEqual(pinned.filters, current.filters);
      assert.equal(pinned.pinned, true);
      assert.equal(pinned.version, 3);

      const staleEdit = yield* Effect.result(
        notebook.save({ ...current, body: "Stale draft" }),
      );
      assert.ok(
        staleEdit._tag === "Failure" &&
          staleEdit.failure._tag === "NoteConflict",
      );
      const staleDelete = yield* Effect.result(
        notebook.remove(current.id, current.version),
      );
      assert.ok(
        staleDelete._tag === "Failure" &&
          staleDelete.failure._tag === "NoteConflict",
      );
      const updated = yield* notebook.save({ ...pinned, body: "Latest draft" });
      assert.equal(updated.pinned, true);
      yield* notebook.remove(updated.id, updated.version);
      for (const operation of [
        notebook.save({ ...updated, body: "Deleted draft" }),
        notebook.pin(updated.id, { version: updated.version, pinned: false }),
        notebook.remove(updated.id, updated.version),
      ]) {
        const result = yield* Effect.result(operation);
        assert.ok(
          result._tag === "Failure" && result.failure._tag === "NoteNotFound",
        );
      }
      assert.deepEqual(yield* notebook.list, []);
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});
