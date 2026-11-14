import { Effect } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";

// Explicit setup command only. App startup never changes database schemas.
export const migrateAppSchema = (
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
