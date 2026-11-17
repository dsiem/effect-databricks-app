import { PgClient } from "@effect/sql-pg";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Layer, Stream } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { Connection } from "effect/sql/SqlConnection";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import { Lakebase } from "../src/lakebase.js";
import { initializeAppSchema } from "../src/lakebase-schema.js";
import { SavedViews } from "../src/saved-views.js";
import { TripComments } from "../src/trip-comments.js";

// Run production feature services, queries and migrations against embedded Postgres.
export const lakebaseFixture = Effect.gen(function* () {
  const database = yield* Effect.acquireRelease(
    Effect.promise(() => PGlite.create()),
    (db) => Effect.promise(() => db.close()),
  );
  const execute = (sql: string, params: ReadonlyArray<unknown>) =>
    Effect.tryPromise({
      try: () => database.query(sql, [...params]).then((result) => result.rows),
      catch: (cause) =>
        new SqlError({
          reason: new UnknownError({ cause, operation: "execute" }),
        }),
    });
  const connection: Connection = {
    execute,
    executeUnprepared: execute,
    executeRaw: execute,
    executeStream: () => Stream.die("Unused stream"),
    executeValues: () => Effect.die("Unused values"),
    executeValuesUnprepared: () => Effect.die("Unused values"),
  };
  const sql = yield* SqlClient.make({
    driver: "pg",
    spanAttributes: [],
    compiler: PgClient.makeCompiler(),
    acquirer: Effect.succeed(connection),
  });
  yield* initializeAppSchema(sql);
  const client = Object.assign(sql, {
    // PgClient's top-level null is SQL NULL, not the JSON string "null".
    json: (value: unknown) =>
      sql`${value === null ? null : JSON.stringify(value)}`,
  });
  const features = yield* Effect.all({
    savedViews: SavedViews,
    tripComments: TripComments,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(SavedViews.layer, TripComments.layer).pipe(
        Layer.provide(
          Layer.succeed(Lakebase, {
            availability: Effect.succeed("available" as const),
            use: (run) => run(client),
          }),
        ),
      ),
    ),
  );
  return {
    sql,
    ...features,
  };
});
