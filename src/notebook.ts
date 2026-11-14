import { PgClient } from "@effect/sql-pg";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Redacted,
  Schema,
  type Scope,
} from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type { Statement } from "effect/sql/Statement";
import {
  type CapabilityAvailability,
  type CurrentUser,
  Note,
  NoteCursor,
  type NoteInput,
  type NotePin,
  type NoteSearch,
  type Notes,
  type TripComment,
  type TripCommentInput,
  type TripCommentSearch,
  type TripComments,
} from "../shared/domain.js";
import { makeCapability } from "./capability.js";
import {
  NoteConflict,
  NoteNotFound,
  type ServiceError,
  unavailable,
} from "./errors.js";
import { pgPassword, restoreCredentialFailure } from "./pg-credentials.js";
import { Settings } from "./settings.js";
import { makeTripComments } from "./trip-comments.js";
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
    : pgPassword(
        workspace
          .request("/api/2.0/postgres/credentials", "POST", {
            endpoint: settings.lakebaseEndpoint,
          })
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Credential)),
            Effect.map((credential) => Redacted.make(credential.token)),
            Effect.mapError((cause) =>
              unavailable(
                "lakebase",
                "Lakebase credentials could not be refreshed. Check workspace authentication and endpoint permissions.",
                cause,
              ),
            ),
          ),
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
    readonly availability: Effect.Effect<CapabilityAvailability>;
    readonly comments: (
      search: TripCommentSearch,
    ) => Effect.Effect<TripComments, ServiceError>;
    readonly addComment: (
      input: TripCommentInput,
      author: CurrentUser | null,
    ) => Effect.Effect<TripComment, ServiceError>;
    readonly list: (search: NoteSearch) => Effect.Effect<Notes, ServiceError>;
    readonly save: (input: NoteInput) => Effect.Effect<Note, ServiceError>;
    readonly pin: (
      id: string,
      input: NotePin,
    ) => Effect.Effect<Note, ServiceError>;
    readonly remove: (
      id: string,
      version: number,
    ) => Effect.Effect<void, ServiceError>;
  }
>()("app/Notebook") {
  static readonly layer = Layer.effect(
    Notebook,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const capability = makeCapability(
        !!(settings.pgHost || settings.lakebaseEndpoint),
      );
      const failure = unavailable(
        "lakebase",
        settings.pgHost || settings.lakebaseEndpoint
          ? "Lakebase is unavailable. Check its connection settings, database grants, and run npm run db:migrate."
          : "Configure Lakebase with PGHOST, PGUSER, and LAKEBASE_ENDPOINT, then run npm run db:migrate.",
      );
      if (!settings.pgHost && !settings.lakebaseEndpoint)
        return {
          availability: capability.availability,
          comments: () => Effect.fail(failure),
          addComment: () => Effect.fail(failure),
          list: () => Effect.fail(failure),
          save: () => Effect.fail(failure),
          pin: () => Effect.fail(failure),
          remove: () => Effect.fail(failure),
        };
      const context = yield* Effect.context<
        Settings | Workspace | Reactivity.Reactivity | Scope.Scope
      >();
      // Keep a single successful pool for the service lifetime. Failed or
      // interrupted discovery is retryable and never blocks unrelated routes.
      const database = yield* makeDatabase.pipe(
        Effect.mapError((cause) =>
          unavailable("lakebase", failure.message, cause),
        ),
        Effect.map((sql) => makeNotebook(sql, failure.message)),
        Effect.provide(context),
        Effect.cachedWithTTL((exit) => (Exit.isSuccess(exit) ? Infinity : 0)),
      );
      return {
        availability: capability.availability,
        comments: (search: TripCommentSearch) =>
          database.pipe(
            Effect.flatMap((notebook) => notebook.comments(search)),
            capability.track,
          ),
        addComment: (input: TripCommentInput, author: CurrentUser | null) =>
          database.pipe(
            Effect.flatMap((notebook) => notebook.addComment(input, author)),
            capability.track,
          ),
        list: (search: NoteSearch) =>
          database.pipe(
            Effect.flatMap((notebook) => notebook.list(search)),
            capability.track,
          ),
        save: (input: NoteInput) =>
          database.pipe(
            Effect.flatMap((notebook) => notebook.save(input)),
            capability.track,
          ),
        pin: (id: string, input: NotePin) =>
          database.pipe(
            Effect.flatMap((notebook) => notebook.pin(id, input)),
            capability.track,
          ),
        remove: (id: string, version: number) =>
          database.pipe(
            Effect.flatMap((notebook) => notebook.remove(id, version)),
            capability.track,
          ),
      };
    }).pipe(Effect.provide(Reactivity.layer)),
  );
}

export const makeNotebook = (
  sql: SqlClient.SqlClient & Pick<PgClient.PgClient, "json">,
  message: string,
) => {
  const databaseError = (cause: unknown) =>
    unavailable("lakebase", message, cause);
  const columns = sql`id::text AS id, title, body, filters, pinned, version,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`;
  const pageSize = 24;
  const list = (search: NoteSearch) =>
    SqlSchema.findAll({
      Request: Schema.Void,
      Result: Schema.Struct({
        ...Note.fields,
        cursor_updated_at: NoteCursor.fields.updatedAt,
      }),
      execute: () => sql`SELECT ${columns},
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
      FROM metrocab.notes AS notes
      ${
        search.cursor
          ? sql`WHERE (pinned, updated_at, id) <
        (${search.cursor.pinned}, ${search.cursor.updatedAt}::timestamptz, ${search.cursor.id}::uuid)`
          : sql``
      }
      ORDER BY notes.pinned DESC, notes.updated_at DESC, notes.id DESC LIMIT ${pageSize + 1}`,
    })(undefined).pipe(
      Effect.mapError(databaseError),
      restoreCredentialFailure,
      Effect.map((results): Notes => {
        const rows = results.slice(0, pageSize);
        const last = rows.at(-1);
        return {
          rows: rows.map(({ cursor_updated_at: _, ...note }) => note),
          nextCursor:
            results.length > pageSize && last
              ? {
                  id: last.id,
                  pinned: last.pinned,
                  updatedAt: last.cursor_updated_at,
                }
              : null,
        };
      }),
      Effect.withSpan("notebook.list"),
    );
  const conflict = (id: string) =>
    new NoteConflict({
      id,
      message:
        "This note changed since you opened it. Close and reopen it to load the latest version before trying again.",
    });
  const notFound = (id: string) =>
    new NoteNotFound({
      id,
      message: "This note has been removed. Your draft has not been saved.",
    });
  const missingWrite = (id: string) =>
    sql`SELECT id FROM metrocab.notes WHERE id = ${id}::uuid`.pipe(
      Effect.mapError(databaseError),
      restoreCredentialFailure,
      Effect.flatMap((rows) =>
        Effect.fail(rows.length ? conflict(id) : notFound(id)),
      ),
    );
  const write = (id: string, execute: () => Statement<unknown>) =>
    SqlSchema.findAll({
      Request: Schema.Void,
      Result: Note,
      execute,
    })(undefined).pipe(
      Effect.mapError(databaseError),
      restoreCredentialFailure,
      Effect.flatMap((rows) =>
        rows[0] ? Effect.succeed(rows[0]) : missingWrite(id),
      ),
    );
  const save = (input: NoteInput) =>
    write(input.id, () =>
      input.version === null
        ? sql`INSERT INTO metrocab.notes (id,title,body,filters)
          VALUES (${input.id}::uuid,${input.title},${input.body},${sql.json(input.filters)})
          ON CONFLICT (id) DO NOTHING RETURNING ${columns}`
        : sql`UPDATE metrocab.notes SET title=${input.title}, body=${input.body},
          filters=${sql.json(input.filters)}, version=version+1, updated_at=now()
          WHERE id=${input.id}::uuid AND version=${input.version}
          RETURNING ${columns}`,
    ).pipe(Effect.withSpan("notebook.save"));
  const pin = (id: string, input: NotePin) =>
    write(
      id,
      () => sql`UPDATE metrocab.notes SET pinned=${input.pinned},
      version=version+1, updated_at=now()
      WHERE id=${id}::uuid AND version=${input.version} RETURNING ${columns}`,
    ).pipe(Effect.withSpan("notebook.pin"));
  const remove = (id: string, version: number) =>
    sql`DELETE FROM metrocab.notes WHERE id = ${id}::uuid AND version=${version} RETURNING id`.pipe(
      Effect.mapError(databaseError),
      restoreCredentialFailure,
      Effect.flatMap((rows) => (rows.length ? Effect.void : missingWrite(id))),
    );
  return { list, save, pin, remove, ...makeTripComments(sql, message) };
};

// Explicit setup command only. App startup never changes database schemas.
export const migrateNotebook = (
  sql: SqlClient.SqlClient,
  appPrincipal?: string,
) =>
  sql.withTransaction(
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
      yield* sql`ALTER TABLE metrocab.notes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0)`;
      yield* sql`CREATE INDEX IF NOT EXISTS notes_listing_idx ON metrocab.notes (pinned DESC, updated_at DESC, id DESC)`;
      yield* sql`CREATE TABLE IF NOT EXISTS metrocab.trip_comments (
        id uuid PRIMARY KEY,
        trip_key text NOT NULL,
        trip jsonb NOT NULL,
        body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
        author jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      // Stable source IDs can have a different length from the old SHA-256 key.
      yield* sql`ALTER TABLE metrocab.trip_comments DROP CONSTRAINT IF EXISTS trip_comments_trip_key_check`;
      yield* sql`CREATE INDEX IF NOT EXISTS trip_comments_listing_idx ON metrocab.trip_comments (trip_key, created_at DESC, id DESC)`;
      if (appPrincipal) {
        yield* sql`GRANT USAGE ON SCHEMA metrocab TO ${sql(appPrincipal)}`;
        yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON metrocab.notes TO ${sql(appPrincipal)}`;
        yield* sql`GRANT SELECT, INSERT, UPDATE ON metrocab.trip_comments TO ${sql(appPrincipal)}`;
      }
    }),
  );

export const migrate = Effect.gen(function* () {
  const sql = yield* makeDatabase;
  yield* migrateNotebook(sql, process.env.APP_SERVICE_PRINCIPAL_ID);
}).pipe(restoreCredentialFailure, Effect.provide(Reactivity.layer));
