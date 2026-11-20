import { Config, Effect, Layer, Schema } from "effect";
import { AuthenticationError, isSqlError, SqlError } from "effect/sql/SqlError";
import * as SqlSchema from "effect/sql/SqlSchema";
import { DatabricksClient } from "@dsiem/sql-warehouse";
import { makeAdmission } from "./admission.js";
import { OperationTimeout, permissionDenied, unavailable } from "./errors.js";
import { queryWarehouse } from "./databricks-capabilities.js";
import { Settings } from "./settings.js";
import { Workspace } from "./workspace.js";

const warehouseConfigured = (settings: typeof Settings.Service) =>
  !!(settings.warehouseId && settings.host && settings.tripSnapshotTable);

const warehouseError = (settings: typeof Settings.Service, cause?: unknown) =>
  unavailable(
    "warehouse",
    warehouseConfigured(settings)
      ? "The NYC taxi query failed. Check warehouse access and SELECT permission on the configured trip snapshot."
      : "Set DATABRICKS_WAREHOUSE_ID and TRIP_SNAPSHOT_TABLE to connect the NYC taxi dataset.",
    cause,
  );

export const warehouseClientLayer = Layer.effectContext(
  Effect.gen(function* () {
    const settings = yield* Settings;
    const workspace = yield* Workspace;
    return yield* DatabricksClient.layerConfig(
      Config.succeed({
        host: settings.host || "https://unconfigured.invalid",
        warehouseId: settings.warehouseId || "unconfigured",
        accessToken: workspace.accessToken.pipe(
          Effect.mapError(
            (cause) =>
              new SqlError({
                reason: new AuthenticationError({
                  cause,
                  message: "Authentication unavailable",
                  operation: "authenticate",
                }),
              }),
          ),
        ),
        queryTimeout: "90 seconds",
        allowDatabricksStorageProxy: !!settings.appName,
      }),
    ).pipe(
      Layer.build,
      Effect.tapError(() =>
        Effect.logError("Invalid SQL client configuration", {
          workspaceHost: settings.host,
          warehouseConfigured: !!settings.warehouseId,
        }),
      ),
      Effect.mapError((cause) => warehouseError(settings, cause)),
    );
  }),
);

export const bindWarehouseClient = queryWarehouse.client(warehouseClientLayer);

export const makeWarehouse = Effect.gen(function* () {
  const settings = yield* Settings;
  const sql = yield* DatabricksClient.DatabricksClient;
  const configured = warehouseConfigured(settings);
  const error = warehouseError(settings);
  const [catalog = "unconfigured", schema = "snapshot", table = "trips"] =
    settings.tripSnapshotTable
      ? settings.tripSnapshotTable.split(".")
      : ["unconfigured", "snapshot", "trips"];
  const admit = makeAdmission({
    service: "warehouse",
    concurrency: settings.warehouseConcurrency,
    timeout: "90 seconds",
  });
  const snapshot = sql`${sql(catalog)}.${sql(schema)}.${sql(table)}`;
  const read = <A>(
    schema: Schema.Decoder<A>,
    statement: Effect.Effect<ReadonlyArray<unknown>, unknown>,
    deniedMessage = "These trips are under lock. You need permission to read trip data.",
  ) =>
    (configured
      ? SqlSchema.findAll({
          Request: Schema.Void,
          Result: schema,
          execute: () => statement,
        })(undefined).pipe(admit)
      : Effect.fail(error)
    ).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Warehouse operation failed", cause),
      ),
      Effect.mapError((cause) => {
        if (cause instanceof OperationTimeout) return cause;
        if (
          isSqlError(cause) &&
          cause.reason._tag === "AuthorizationError" &&
          cause.reason.operation !== "download"
        )
          return permissionDenied(deniedMessage);
        return unavailable(error.service, error.message, cause);
      }),
    );
  return { sql, snapshot, read, error };
});
