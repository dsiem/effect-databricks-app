import { PgClient } from "@effect/sql-pg";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Stream } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { Connection } from "effect/sql/SqlConnection";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import { makeNotebook, migrateNotebook } from "../src/notebook.js";

// Run the production compiler, migrations and notebook against embedded Postgres.
export const notebookFixture = Effect.gen(function* () {
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
  yield* migrateNotebook(sql);
  return {
    sql,
    notebook: makeNotebook(
      Object.assign(sql, {
        json: (value: unknown) => sql`${JSON.stringify(value)}`,
      }),
      "Lakebase unavailable",
    ),
  };
});
