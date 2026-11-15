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
      // Rename in place so deployed saved views keep their rows, grants and indexes.
      yield* sql`DO $$ BEGIN
        IF to_regclass('metrocab.notes') IS NOT NULL THEN
          IF to_regclass('metrocab.saved_views') IS NOT NULL THEN
            RAISE EXCEPTION 'Both legacy and current saved-view tables exist; reconcile them before migrating';
          END IF;
          ALTER TABLE metrocab.notes RENAME TO saved_views;
        END IF;
        IF to_regclass('metrocab.notes_listing_idx') IS NOT NULL THEN
          ALTER INDEX metrocab.notes_listing_idx RENAME TO saved_views_listing_idx;
        END IF;
      END $$`;
      yield* sql`CREATE TABLE IF NOT EXISTS metrocab.saved_views (
      id uuid PRIMARY KEY,
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      body text NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
      filters jsonb NOT NULL DEFAULT '{}',
      pinned boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
      yield* sql`ALTER TABLE metrocab.saved_views ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0)`;
      yield* sql`CREATE INDEX IF NOT EXISTS saved_views_listing_idx ON metrocab.saved_views (pinned DESC, updated_at DESC, id DESC)`;
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
        yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON metrocab.saved_views TO ${sql(appPrincipal)}`;
        yield* sql`GRANT SELECT, INSERT, UPDATE ON metrocab.trip_comments TO ${sql(appPrincipal)}`;
      }
    }),
  );
