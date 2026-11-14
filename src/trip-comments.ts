import type { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import {
  type CurrentUser,
  TripComment,
  TripCommentCursor,
  type TripCommentInput,
  type TripCommentSearch,
  type TripComments,
} from "./domain.js";
import { InvalidRequest, unavailable } from "./errors.js";
import { restoreCredentialFailure } from "./pg-credentials.js";

export const makeTripComments = (
  sql: SqlClient.SqlClient & Pick<PgClient.PgClient, "json">,
  message: string,
) => {
  const databaseError = (cause: unknown) =>
    unavailable("lakebase", message, cause);
  const columns = sql`id::text AS id, trip, body, author,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`;
  const comments = (search: TripCommentSearch) =>
    SqlSchema.findAll({
      Request: Schema.Void,
      Result: Schema.Struct({
        ...TripComment.fields,
        cursor_created_at: TripCommentCursor.fields.createdAt,
      }),
      execute: () => sql`SELECT ${columns},
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
        FROM metrocab.trip_comments AS comments
        WHERE trip_key=${search.trip.trip_id}
        ${
          search.cursor
            ? sql`AND (created_at, id) <
          (${search.cursor.createdAt}::timestamptz, ${search.cursor.id}::uuid)`
            : sql``
        }
        ORDER BY comments.created_at DESC, comments.id DESC LIMIT 26`,
    })(undefined).pipe(
      Effect.mapError(databaseError),
      restoreCredentialFailure,
      Effect.map((results): TripComments => {
        const rows = results.slice(0, 25);
        const last = rows.at(-1);
        return {
          rows: rows.map(({ cursor_created_at: _, ...comment }) => comment),
          nextCursor:
            results.length > 25 && last
              ? { id: last.id, createdAt: last.cursor_created_at }
              : null,
        };
      }),
      Effect.withSpan("notebook.tripComments"),
    );
  const addComment = (input: TripCommentInput, author: CurrentUser | null) =>
    SqlSchema.findAll({
      Request: Schema.Void,
      Result: TripComment,
      // A repeated submission of the same draft is safe after a lost response.
      // An existing ID can never replace another comment's content or author.
      execute:
        () => sql`INSERT INTO metrocab.trip_comments AS existing (id,trip_key,trip,body,author)
        VALUES (${input.id}::uuid,${input.trip.trip_id},${sql.json(input.trip)},${input.body},${author === null ? sql`'null'::jsonb` : sql.json(author)})
        ON CONFLICT (id) DO UPDATE SET id=existing.id
        WHERE existing.trip_key=EXCLUDED.trip_key AND existing.body=EXCLUDED.body
          AND existing.author=EXCLUDED.author
        RETURNING ${columns}`,
    })(undefined).pipe(
      Effect.mapError(databaseError),
      restoreCredentialFailure,
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(rows[0])
          : Effect.fail(
              new InvalidRequest({
                message:
                  "This comment was already submitted with different content. Reopen the trip to start a new comment.",
              }),
            ),
      ),
      Effect.withSpan("notebook.addTripComment"),
    );
  return { comments, addComment };
};
