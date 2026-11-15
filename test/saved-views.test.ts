import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import type { SavedView, SavedViewSearch } from "../shared/domain.js";
import { type ServiceError, UpstreamError } from "../src/errors.js";
import { Lakebase } from "../src/lakebase.js";
import { migrateAppSchema } from "../src/migrations.js";
import { pgPassword, restoreCredentialFailure } from "../src/pg-credentials.js";
import { makeSavedViews, SavedViews } from "../src/saved-views.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";
import { lakebaseFixture } from "./lakebase-fixture.js";

const input = {
  id: "1b7f2115-e891-46a7-a3ad-c26405b2f5a2",
  title: "A saved view",
  body: "",
  filters: {},
  version: null,
};
const operations: Record<
  string,
  (
    savedViews: typeof SavedViews.Service,
  ) => Effect.Effect<unknown, ServiceError>
> = {
  list: (savedViews: typeof SavedViews.Service) => savedViews.list({}),
  save: (savedViews: typeof SavedViews.Service) => savedViews.save(input),
  pin: (savedViews) => savedViews.pin(input.id, { version: 1, pinned: true }),
  remove: (savedViews: typeof SavedViews.Service) =>
    savedViews.remove(input.id, 1),
};
const runSavedViews = <A, E>(
  credentials: Effect.Effect<unknown, ServiceError>,
  use: (savedViews: typeof SavedViews.Service) => Effect.Effect<A, E>,
) =>
  Effect.runPromiseExit(
    Effect.flatMap(SavedViews, use).pipe(
      Effect.provide(
        SavedViews.layer.pipe(
          Layer.provide(Lakebase.layer),
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
  test(`saved views ${name} preserves credential diagnostics as a typed service failure`, async () => {
    const original = new Error("credential diagnostic");
    const upstream = new UpstreamError({
      service: "workspace",
      message: "Authentication failed",
      cause: original,
    });
    const exit = await runSavedViews(Effect.fail(upstream), operation);
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

  test(`saved views ${name} preserves unexpected defects`, async () => {
    const defect = new Error("programming error");
    const exit = await runSavedViews(Effect.die(defect), operation);
    assert.ok(Exit.isFailure(exit));
    assert.ok(
      exit.cause.reasons.some(
        (reason) => Cause.isDieReason(reason) && reason.defect === defect,
      ),
    );
    assert.equal(Cause.hasFails(exit.cause), false);
  });

  test(`saved views ${name} preserves interruption`, async () => {
    const exit = await runSavedViews(Effect.interrupt, operation);
    assert.ok(Exit.isFailure(exit));
    assert.ok(Cause.hasInterruptsOnly(exit.cause));
  });
}

test("invalid Lakebase credential payload is a typed error with its schema diagnostic", async () => {
  const exit = await runSavedViews(
    Effect.succeed({ token: 42 }),
    (savedViews) => savedViews.list({}),
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
  use: (savedViews: typeof SavedViews.Service) => Effect.Effect<A, E>,
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
        makeSavedViews(
          Object.assign(sql, {
            json: (value: unknown) => sql`${JSON.stringify(value)}`,
          }),
        ),
      );
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );

test("saved views maps SQL failures without losing the original cause", async () => {
  const sqlError = new SqlError({
    reason: new UnknownError({
      cause: new Error("database diagnostic"),
      message: "Database failed",
      operation: "execute",
    }),
  });
  const exit = await withRows(Effect.fail(sqlError), (savedViews) =>
    savedViews.list({}),
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "ServiceUnavailable");
  assert.equal(error.value.cause, sqlError);
});

test("saved views preserves row decoding diagnostics", async () => {
  const exit = await withRows(
    Effect.succeed([{ id: "invalid" }]),
    (savedViews) => savedViews.list({}),
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "ServiceUnavailable");
  assert.equal(Reflect.get(error.value.cause as object, "_tag"), "SchemaError");
});

test("removing a missing saved view keeps its distinct not-found error", async () => {
  const exit = await withRows(Effect.succeed([]), (savedViews) =>
    savedViews.remove(input.id, 1),
  );
  assert.ok(Exit.isFailure(exit));
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(error._tag === "Some" && error.value._tag === "SavedViewNotFound");
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

test("legacy saved views migrate in place with their rows, versions, pins and grants intact", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { savedViews, sql } = yield* lakebaseFixture;
      const created = yield* savedViews.save({
        ...input,
        body: "Keep this finding",
        filters: { zip: "10001" },
      });
      yield* savedViews.pin(created.id, {
        pinned: true,
        version: created.version,
      });
      const before = yield* savedViews.list({});
      yield* sql`CREATE ROLE saved_view_reader`;
      yield* sql`GRANT SELECT ON metrocab.saved_views TO saved_view_reader`;
      yield* sql`ALTER TABLE metrocab.saved_views RENAME TO notes`;
      yield* sql`ALTER INDEX metrocab.saved_views_listing_idx RENAME TO notes_listing_idx`;
      const identity =
        yield* sql`SELECT 'metrocab.notes'::regclass::oid AS oid`;

      yield* migrateAppSchema(sql);
      yield* migrateAppSchema(sql);

      assert.deepEqual(yield* savedViews.list({}), before);
      assert.deepEqual(
        yield* sql`SELECT 'metrocab.saved_views'::regclass::oid AS oid`,
        identity,
      );
      assert.deepEqual(
        yield* sql`SELECT has_table_privilege('saved_view_reader', 'metrocab.saved_views', 'SELECT') AS allowed`,
        [{ allowed: true }],
      );
      assert.deepEqual(
        yield* sql`SELECT to_regclass('metrocab.notes') AS legacy_table, to_regclass('metrocab.notes_listing_idx') AS legacy_index`,
        [{ legacy_table: null, legacy_index: null }],
      );
      const current = before.rows[0];
      assert.ok(current);
      const updated = yield* savedViews.save({
        ...current,
        title: "Updated after migration",
      });
      assert.equal(updated.version, current.version + 1);
      assert.equal(updated.pinned, true);
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});

test("migration refuses ambiguous saved-view tables without losing either dataset", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { savedViews, sql } = yield* lakebaseFixture;
      yield* savedViews.save(input);
      yield* sql`CREATE TABLE metrocab.notes AS SELECT * FROM metrocab.saved_views`;
      const outcome = yield* Effect.result(migrateAppSchema(sql));
      assert.equal(outcome._tag, "Failure");
      assert.equal((yield* savedViews.list({})).rows.length, 1);
      assert.equal((yield* sql`SELECT id FROM metrocab.notes`).length, 1);
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});

test("versioned saved-view writes reject stale editors, pin conflicts, and deleted-view resurrection", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { savedViews, sql } = yield* lakebaseFixture;
      // Migrations are repeatable and existing rows keep their content/version.
      const created = yield* savedViews.save(input);
      yield* sql`ALTER TABLE metrocab.saved_views DROP COLUMN version`;
      yield* migrateAppSchema(sql);
      yield* migrateAppSchema(sql);
      assert.equal((yield* savedViews.list({})).rows[0]?.title, input.title);
      assert.equal(created.version, 1);
      assert.equal(created.pinned, false);
      const duplicate = yield* Effect.result(
        savedViews.save({ ...input, title: "Duplicate" }),
      );
      assert.ok(
        duplicate._tag === "Failure" &&
          duplicate.failure._tag === "SavedViewConflict",
      );

      const edits = yield* Effect.all(
        [
          savedViews
            .save({ ...created, title: "First editor" })
            .pipe(Effect.result),
          savedViews
            .save({ ...created, title: "Second editor" })
            .pipe(Effect.result),
        ],
        { concurrency: 2 },
      );
      const successes = edits.filter((edit) => edit._tag === "Success");
      assert.equal(successes.length, 1);
      const failure = edits.find((edit) => edit._tag === "Failure");
      assert.ok(
        failure?._tag === "Failure" &&
          failure.failure._tag === "SavedViewConflict",
      );
      const current = (yield* savedViews.list({})).rows[0];
      assert.ok(current);
      assert.equal(current.version, 2);
      assert.equal(current.title, successes[0]?.success.title);

      const stalePin = yield* Effect.result(
        savedViews.pin(created.id, { version: 1, pinned: true }),
      );
      assert.ok(
        stalePin._tag === "Failure" &&
          stalePin.failure._tag === "SavedViewConflict",
      );
      const pinned = yield* savedViews.pin(current.id, {
        version: current.version,
        pinned: true,
      });
      assert.equal(pinned.title, current.title);
      assert.equal(pinned.body, current.body);
      assert.deepEqual(pinned.filters, current.filters);
      assert.equal(pinned.pinned, true);
      assert.equal(pinned.version, 3);

      const staleEdit = yield* Effect.result(
        savedViews.save({ ...current, body: "Stale draft" }),
      );
      assert.ok(
        staleEdit._tag === "Failure" &&
          staleEdit.failure._tag === "SavedViewConflict",
      );
      const staleDelete = yield* Effect.result(
        savedViews.remove(current.id, current.version),
      );
      assert.ok(
        staleDelete._tag === "Failure" &&
          staleDelete.failure._tag === "SavedViewConflict",
      );
      const updated = yield* savedViews.save({
        ...pinned,
        body: "Latest draft",
      });
      assert.equal(updated.pinned, true);
      yield* savedViews.remove(updated.id, updated.version);
      for (const operation of [
        savedViews.save({ ...updated, body: "Deleted draft" }),
        savedViews.pin(updated.id, { version: updated.version, pinned: false }),
        savedViews.remove(updated.id, updated.version),
      ]) {
        const result = yield* Effect.result(operation);
        assert.ok(
          result._tag === "Failure" &&
            result.failure._tag === "SavedViewNotFound",
        );
      }
      assert.deepEqual(yield* savedViews.list({}), {
        rows: [],
        nextCursor: null,
      });
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});

test("saved views pages reach every saved view beyond 200, preserving pins, timestamp precision, and ties", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { savedViews, sql } = yield* lakebaseFixture;
      assert.deepEqual(yield* savedViews.list({}), {
        rows: [],
        nextCursor: null,
      });
      const inputs = Array.from({ length: 217 }, (_, index) => ({
        ...input,
        id: randomUUID(),
        title: String(index),
      }));
      yield* Effect.forEach(inputs, (savedView) => savedViews.save(savedView));
      yield* sql`UPDATE metrocab.saved_views SET pinned = title::int < 26,
        updated_at = '2026-11-13T10:00:00Z'::timestamptz +
          (title::int % 3) * INTERVAL '1 microsecond'`;
      const expected = [...inputs].sort(
        (a, b) =>
          Number(Number(b.title) < 26) - Number(Number(a.title) < 26) ||
          (Number(b.title) % 3) - (Number(a.title) % 3) ||
          b.id.localeCompare(a.id),
      );
      const collected: SavedView[] = [];
      let search: SavedViewSearch = {};
      let pages = 0;
      while (true) {
        const page = yield* savedViews.list(search);
        pages++;
        assert.ok(pages <= 10, "continuation must advance");
        assert.ok(page.rows.length > 0 && page.rows.length <= 24);
        collected.push(...page.rows);
        if (!page.nextCursor) break;
        search = { cursor: page.nextCursor };
      }
      assert.equal(pages, 10);
      assert.deepEqual(
        collected.map((savedView) => savedView.id),
        expected.map((savedView) => savedView.id),
      );
      assert.equal(
        new Set(collected.map((savedView) => savedView.id)).size,
        217,
      );
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});

test("continuation survives deletion of the boundary saved view and ignores newer inserts", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { savedViews, sql } = yield* lakebaseFixture;
      for (let index = 0; index < 25; index++) {
        yield* savedViews.save({
          ...input,
          id: randomUUID(),
          title: String(index),
        });
      }
      yield* sql`UPDATE metrocab.saved_views SET updated_at = '2026-11-13T10:00:00Z'::timestamptz
        + title::int * INTERVAL '1 second'`;
      const first = yield* savedViews.list({});
      assert.ok(first.nextCursor);
      const boundary = first.rows.at(-1);
      assert.ok(boundary);
      yield* savedViews.remove(boundary.id, boundary.version);
      assert.equal((yield* savedViews.list({})).nextCursor, null);
      const arrival = yield* savedViews.save({
        ...input,
        id: randomUUID(),
        title: "New arrival",
      });
      yield* sql`UPDATE metrocab.saved_views SET updated_at = '2026-11-14T00:00:00Z'::timestamptz WHERE id = ${arrival.id}::uuid`;
      const last = yield* savedViews.list({ cursor: first.nextCursor });
      assert.deepEqual(
        last.rows.map((savedView) => savedView.title),
        ["0"],
      );
      assert.equal(last.nextCursor, null);
      assert.equal((yield* savedViews.list({})).rows[0]?.title, "New arrival");
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
  );
});
