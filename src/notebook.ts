import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlSchema from "effect/sql/SqlSchema";
import { AppError, Note, type NoteInput, unavailable } from "./domain.js";
import { Settings } from "./settings.js";
import { Workspace } from "./workspace.js";

const Credential = Schema.Struct({ token: Schema.NonEmptyString });
const Endpoint = Schema.Struct({
  status: Schema.Struct({
    hosts: Schema.Struct({ host: Schema.NonEmptyString }),
  }),
});
export const makeDatabase = Effect.gen(function* () {
  const settings = yield* Settings;
  const workspace = yield* Workspace;
  const host =
    settings.pgHost ||
    (yield* workspace
      .request(`/api/2.0/postgres/${settings.lakebaseEndpoint}`)
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Endpoint)),
        Effect.map((endpoint) => endpoint.status.hosts.host),
      ));
  const password = Redacted.value(settings.pgPassword)
    ? Effect.succeed(settings.pgPassword)
    : workspace
        .request("/api/2.0/postgres/credentials", "POST", {
          endpoint: settings.lakebaseEndpoint,
        })
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Credential)),
          Effect.map((credential) => Redacted.make(credential.token)),
          Effect.orDie,
        );
  return yield* PgClient.make({
    host,
    port: settings.pgPort,
    database: settings.pgDatabase,
    username: settings.pgUser || settings.clientId,
    password,
    ssl: true,
    minConnections: 0,
    maxConnections: 4,
    connectTimeout: "15 seconds",
    acquireTimeout: "20 seconds",
    idleTimeout: "30 seconds",
    connectionTTL: "45 minutes",
    startupParameters: { statement_timeout: "15000" },
    applicationName: "metrocab-effect",
  });
});

export class Notebook extends Context.Service<
  Notebook,
  {
    readonly list: Effect.Effect<ReadonlyArray<Note>, AppError>;
    readonly save: (input: NoteInput) => Effect.Effect<Note, AppError>;
    readonly remove: (id: string) => Effect.Effect<void, AppError>;
  }
>()("app/Notebook") {
  static readonly layer = Layer.effect(
    Notebook,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const failure = unavailable(
        "lakebase",
        settings.pgHost || settings.lakebaseEndpoint
          ? "Lakebase is unavailable. Check its connection settings, database grants, and run npm run db:migrate."
          : "Configure Lakebase with PGHOST, PGUSER, and LAKEBASE_ENDPOINT, then run npm run db:migrate.",
      );
      if (!settings.pgHost && !settings.lakebaseEndpoint)
        return {
          list: Effect.fail(failure),
          save: () => Effect.fail(failure),
          remove: () => Effect.fail(failure),
        };
      const sql = yield* makeDatabase.pipe(Effect.mapError(() => failure));
      const columns = sql`id::text AS id, title, body, filters, pinned,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`;
      const list = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Note,
        execute: () =>
          sql`SELECT ${columns} FROM metrocab.notes ORDER BY pinned DESC, updated_at DESC LIMIT 200`,
      })(undefined).pipe(Effect.catchCause(() => Effect.fail(failure)));
      const save = (input: NoteInput) =>
        SqlSchema.findOne({
          Request: Schema.Void,
          Result: Note,
          execute:
            () => sql`INSERT INTO metrocab.notes (id,title,body,filters,pinned)
        VALUES (${input.id}::uuid,${input.title},${input.body},${sql.json(input.filters)},${input.pinned})
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body,
          filters=EXCLUDED.filters, pinned=EXCLUDED.pinned, updated_at=now()
        RETURNING ${columns}`,
        })(undefined).pipe(
          Effect.catchCause(() => Effect.fail(failure)),
          Effect.withSpan("notebook.save"),
        );
      const remove = (id: string) =>
        sql`DELETE FROM metrocab.notes WHERE id = ${id}::uuid RETURNING id`.pipe(
          Effect.flatMap((rows) =>
            rows.length
              ? Effect.void
              : Effect.fail(
                  new AppError({
                    status: 404,
                    code: "note_not_found",
                    message: "This note has already been removed.",
                  }),
                ),
          ),
          Effect.catch((error) =>
            Effect.fail(error instanceof AppError ? error : failure),
          ),
        );
      return { list, save, remove };
    }).pipe(Effect.provide(Reactivity.layer)),
  );
}

// Explicit setup command only. App startup never changes database schemas.
export const migrate = Effect.gen(function* () {
  const sql = yield* makeDatabase;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(58302611)`;
      yield* sql`CREATE SCHEMA IF NOT EXISTS metrocab`;
      yield* sql`CREATE TABLE IF NOT EXISTS metrocab.notes (
      id uuid PRIMARY KEY,
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      body text NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
      filters jsonb NOT NULL DEFAULT '{}',
      pinned boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
      const appPrincipal = process.env.APP_SERVICE_PRINCIPAL_ID;
      if (appPrincipal) {
        yield* sql`GRANT USAGE ON SCHEMA metrocab TO ${sql(appPrincipal)}`;
        yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON metrocab.notes TO ${sql(appPrincipal)}`;
      }
    }),
  );
}).pipe(Effect.provide(Reactivity.layer));
