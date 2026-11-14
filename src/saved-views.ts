import { Context, Effect, Layer, Schema } from "effect";
import * as SqlSchema from "effect/sql/SqlSchema";
import type { Statement } from "effect/sql/Statement";
import {
  Note,
  NoteCursor,
  type NoteInput,
  type NotePin,
  type NoteSearch,
  type Notes,
} from "../shared/domain.js";
import { NoteConflict, NoteNotFound } from "./errors.js";
import { Lakebase, type LakebaseSql, lakebaseUnavailable } from "./lakebase.js";
import { restoreCredentialFailure } from "./pg-credentials.js";

export const makeSavedViews = (sql: LakebaseSql) => {
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
      Effect.mapError(lakebaseUnavailable),
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
      Effect.withSpan("savedViews.list"),
    );
  const conflict = (id: string) =>
    new NoteConflict({
      id,
      message:
        "This saved view changed since you opened it. Close and reopen it to load the latest version before trying again.",
    });
  const notFound = (id: string) =>
    new NoteNotFound({
      id,
      message:
        "This saved view has been removed. Your draft has not been saved.",
    });
  const missingWrite = (id: string) =>
    sql`SELECT id FROM metrocab.notes WHERE id = ${id}::uuid`.pipe(
      Effect.mapError(lakebaseUnavailable),
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
      Effect.mapError(lakebaseUnavailable),
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
    ).pipe(Effect.withSpan("savedViews.save"));
  const pin = (id: string, input: NotePin) =>
    write(
      id,
      () => sql`UPDATE metrocab.notes SET pinned=${input.pinned},
      version=version+1, updated_at=now()
      WHERE id=${id}::uuid AND version=${input.version} RETURNING ${columns}`,
    ).pipe(Effect.withSpan("savedViews.pin"));
  const remove = (id: string, version: number) =>
    sql`DELETE FROM metrocab.notes WHERE id = ${id}::uuid AND version=${version} RETURNING id`.pipe(
      Effect.mapError(lakebaseUnavailable),
      restoreCredentialFailure,
      Effect.flatMap((rows) => (rows.length ? Effect.void : missingWrite(id))),
    );
  return { list, save, pin, remove };
};

export class SavedViews extends Context.Service<
  SavedViews,
  ReturnType<typeof makeSavedViews>
>()("app/SavedViews") {
  static readonly layer = Layer.effect(
    SavedViews,
    Effect.map(Lakebase, (database) => ({
      list: (search: NoteSearch) =>
        database.use((sql) => makeSavedViews(sql).list(search)),
      save: (input: NoteInput) =>
        database.use((sql) => makeSavedViews(sql).save(input)),
      pin: (id: string, input: NotePin) =>
        database.use((sql) => makeSavedViews(sql).pin(id, input)),
      remove: (id: string, version: number) =>
        database.use((sql) => makeSavedViews(sql).remove(id, version)),
    })),
  );
}
