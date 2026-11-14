import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";

const StatementResponse = Schema.Struct({
  statement_id: Schema.NonEmptyString,
  status: Schema.Struct({
    state: Schema.Literals([
      "PENDING",
      "RUNNING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "CLOSED",
    ]),
    error: Schema.optionalKey(Schema.Unknown),
  }),
  result: Schema.optionalKey(
    Schema.Struct({
      data_array: Schema.optionalKey(
        Schema.Array(Schema.Array(Schema.Unknown)),
      ),
    }),
  ),
});
type StatementResponse = typeof StatementResponse.Type;

const identifier = (part: string) => `\`${part.replaceAll("`", "``")}\``;
const principalPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const dieMessage = (message: string) => Effect.die(new Error(message));

const program = Effect.gen(function* () {
  const settings = yield* Settings;
  const workspace = yield* Workspace;
  const principal = process.env.APP_SERVICE_PRINCIPAL_ID ?? "";
  if (!principalPattern.test(principal))
    return yield* dieMessage(
      "APP_SERVICE_PRINCIPAL_ID must be the Databricks App service principal UUID.",
    );
  if (!settings.warehouseId || !settings.tripSnapshotTable)
    return yield* dieMessage(
      "Set DATABRICKS_WAREHOUSE_ID and TRIP_SNAPSHOT_TABLE before seeding.",
    );

  const parts = settings.tripSnapshotTable.split(".");
  const [catalog, schema, table] = parts;
  if (!catalog || !schema || !table || parts.length !== 3)
    return yield* dieMessage(
      "TRIP_SNAPSHOT_TABLE must be a three-part Unity Catalog identifier.",
    );
  const qualifiedCatalog = identifier(catalog);
  const qualifiedSchema = `${qualifiedCatalog}.${identifier(schema)}`;
  const qualifiedTable = `${qualifiedSchema}.${identifier(table)}`;
  const principalIdentifier = identifier(principal);

  const execute = (statement: string) =>
    Effect.gen(function* () {
      const initial = yield* workspace.request(
        "/api/2.0/sql/statements",
        "POST",
        {
          warehouse_id: settings.warehouseId,
          statement,
          wait_timeout: "20s",
          on_wait_timeout: "CONTINUE",
          disposition: "INLINE",
          format: "JSON_ARRAY",
        },
      );
      let response: StatementResponse =
        Schema.decodeUnknownSync(StatementResponse)(initial);
      let polls = 0;
      while (
        response.status.state === "PENDING" ||
        response.status.state === "RUNNING"
      ) {
        if (polls++ >= 900)
          return yield* dieMessage(
            "Snapshot SQL statement did not finish within 15 minutes.",
          );
        yield* Effect.sleep("1 second");
        const next = yield* workspace.request(
          `/api/2.0/sql/statements/${encodeURIComponent(response.statement_id)}`,
        );
        response = Schema.decodeUnknownSync(StatementResponse)(next);
      }
      if (response.status.state !== "SUCCEEDED") {
        const error = response.status.error;
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : String(error ?? response.status.state);
        return yield* dieMessage(
          `Snapshot SQL statement ${response.status.state}: ${message}`,
        );
      }
      return response.result?.data_array ?? [];
    });

  yield* execute(
    `CREATE TABLE IF NOT EXISTS ${qualifiedTable} USING DELTA AS
     SELECT uuid() AS trip_id, source.* FROM samples.nyctaxi.trips AS source`,
  );
  yield* execute(
    `GRANT USE CATALOG ON CATALOG ${qualifiedCatalog} TO ${principalIdentifier}`,
  );
  yield* execute(
    `GRANT USE SCHEMA ON SCHEMA ${qualifiedSchema} TO ${principalIdentifier}`,
  );
  yield* execute(
    `GRANT SELECT ON TABLE ${qualifiedTable} TO ${principalIdentifier}`,
  );

  const rows = yield* execute(
    `SELECT CAST(COUNT(*) AS BIGINT),
       CAST(COUNT(DISTINCT trip_id) AS BIGINT),
       CAST(COALESCE(SUM(CASE WHEN trip_id IS NULL THEN 1 ELSE 0 END), 0) AS BIGINT)
     FROM ${qualifiedTable}`,
  );
  const counts = rows[0];
  if (counts?.length !== 3)
    return yield* dieMessage(
      "Snapshot validation returned an unexpected result shape.",
    );
  const numeric = (value: unknown) => {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
  };
  const [rowCount, uniqueIds, missingIds] = counts.map(numeric);
  if (
    rowCount === undefined ||
    uniqueIds === undefined ||
    missingIds === undefined ||
    rowCount === 0 ||
    uniqueIds !== rowCount ||
    missingIds !== 0
  )
    return yield* dieMessage(
      "Snapshot validation failed: expected a non-empty table with one non-null unique trip_id per row.",
    );

  yield* Effect.log(
    `Trip snapshot ready: ${qualifiedTable} (${rowCount} rows)`,
  );
}).pipe(
  Effect.scoped,
  Effect.provide(Workspace.layer.pipe(Layer.provideMerge(Settings.layer))),
);

NodeRuntime.runMain(program);
