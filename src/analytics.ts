import { Cache, Context, Effect, Exit, Layer, Schema } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import { AuthenticationError, SqlError } from "effect/sql/SqlError";
import * as SqlSchema from "effect/sql/SqlSchema";
import { DatabricksClient } from "effect-sql-databricks";
import { makeAdmission } from "./admission.js";
import { makeCapability } from "./capability.js";
import {
  type CapabilityAvailability,
  Daily,
  type Filters,
  Hourly,
  Metadata,
  type Overview,
  Summary,
  Trip,
  type TripSearch,
  type Trips,
  Zone,
} from "./domain.js";
import { OperationTimeout, type ServiceError, unavailable } from "./errors.js";
import { Settings } from "./settings.js";
import { Workspace } from "./workspace.js";

export class Analytics extends Context.Service<
  Analytics,
  {
    readonly availability: Effect.Effect<CapabilityAvailability>;
    readonly metadata: Effect.Effect<typeof Metadata.Type, ServiceError>;
    readonly overview: (
      filters: Filters,
    ) => Effect.Effect<Overview, ServiceError>;
    readonly trips: (
      search: TripSearch,
    ) => Effect.Effect<typeof Trips.Type, ServiceError>;
  }
>()("app/Analytics") {
  static readonly layer = Layer.effect(
    Analytics,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const workspace = yield* Workspace;
      const [catalog = "unconfigured", schema = "snapshot", table = "trips"] =
        settings.tripSnapshotTable
          ? settings.tripSnapshotTable.split(".")
          : ["unconfigured", "snapshot", "trips"];
      const capability = makeCapability(
        !!(settings.warehouseId && settings.host && settings.tripSnapshotTable),
      );
      const admit = makeAdmission({
        service: "warehouse",
        concurrency: settings.warehouseConcurrency,
        timeout: "90 seconds",
      });
      const error = unavailable(
        "warehouse",
        settings.warehouseId && settings.host && settings.tripSnapshotTable
          ? "The NYC taxi query failed. Check warehouse access and SELECT permission on the configured trip snapshot."
          : "Set DATABRICKS_WAREHOUSE_ID and TRIP_SNAPSHOT_TABLE to connect the NYC taxi dataset.",
      );
      const sql = yield* DatabricksClient.make({
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
      }).pipe(
        Effect.tapError(() =>
          Effect.logError("Invalid SQL client configuration", {
            workspaceHost: settings.host,
            warehouseConfigured: !!settings.warehouseId,
          }),
        ),
        Effect.mapError((cause) =>
          unavailable(error.service, error.message, cause),
        ),
      );
      const snapshot = sql`${sql(catalog)}.${sql(schema)}.${sql(table)}`;
      const read = <A>(
        schema: Schema.Decoder<A>,
        statement: Effect.Effect<ReadonlyArray<unknown>, unknown>,
      ) =>
        (settings.warehouseId && settings.host && settings.tripSnapshotTable
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
          Effect.mapError((cause) =>
            cause instanceof OperationTimeout
              ? cause
              : unavailable(error.service, error.message, cause),
          ),
          capability.track,
        );
      const where = (filters: Filters) => sql`WHERE 1 = 1
      ${filters.from ? sql`AND tpep_pickup_datetime >= CAST(${filters.from} AS TIMESTAMP)` : sql``}
      ${filters.to ? sql`AND tpep_pickup_datetime < CAST(${filters.to} AS TIMESTAMP) + INTERVAL 1 DAY` : sql``}
      ${filters.zip ? sql`AND CAST(pickup_zip AS STRING) = ${filters.zip}` : sql``}`;

      const metadataCache = yield* Cache.makeWith(
        (_key: "dataset") =>
          read(
            Metadata,
            sql`SELECT
      CAST(MIN(tpep_pickup_datetime) AS DATE)::STRING AS from,
      CAST(MAX(tpep_pickup_datetime) AS DATE)::STRING AS to,
      CAST(COUNT(*) AS DOUBLE) AS trips FROM ${snapshot}`,
          ).pipe(
            Effect.flatMap((rows) =>
              rows[0] ? Effect.succeed(rows[0]) : Effect.fail(error),
            ),
          ),
        {
          capacity: 1,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? "5 minutes" : 0),
        },
      );
      const metadata = Cache.get(metadataCache, "dataset");
      const overviewCache = yield* Cache.makeWith(
        (key: string) => {
          const filters = JSON.parse(key) as Filters;
          const predicate = where(filters);
          return Effect.all(
            {
              summary: read(
                Summary,
                sql`SELECT CAST(COUNT(*) AS DOUBLE) AS trips,
          CAST(COALESCE(SUM(fare_amount), 0) AS DOUBLE) AS revenue,
          CAST(COALESCE(AVG(fare_amount), 0) AS DOUBLE) AS avg_fare,
          CAST(COALESCE(AVG(trip_distance), 0) AS DOUBLE) AS avg_distance,
          CAST(COALESCE(AVG(timestampdiff(SECOND, tpep_pickup_datetime, tpep_dropoff_datetime) / 60.0), 0) AS DOUBLE) AS avg_duration
          FROM ${snapshot} ${predicate}`,
              ).pipe(
                Effect.map(
                  (rows) =>
                    rows[0] ?? {
                      trips: 0,
                      revenue: 0,
                      avg_fare: 0,
                      avg_distance: 0,
                      avg_duration: 0,
                    },
                ),
              ),
              daily: read(
                Daily,
                sql`SELECT CAST(CAST(tpep_pickup_datetime AS DATE) AS STRING) AS day,
          CAST(COUNT(*) AS DOUBLE) AS trips, CAST(COALESCE(SUM(fare_amount),0) AS DOUBLE) AS revenue
          FROM ${snapshot} ${predicate} GROUP BY 1 ORDER BY 1`,
              ),
              hourly: read(
                Hourly,
                sql`SELECT CAST(HOUR(tpep_pickup_datetime) AS DOUBLE) AS hour,
          CAST(COUNT(*) AS DOUBLE) AS trips, CAST(COALESCE(AVG(fare_amount),0) AS DOUBLE) AS avg_fare
          FROM ${snapshot} ${predicate} GROUP BY 1 ORDER BY 1`,
              ),
              zones: read(
                Zone,
                sql`SELECT COALESCE(CAST(pickup_zip AS STRING), 'Unknown') AS zip,
          CAST(COUNT(*) AS DOUBLE) AS trips, CAST(COALESCE(SUM(fare_amount),0) AS DOUBLE) AS revenue,
          CAST(COALESCE(AVG(fare_amount),0) AS DOUBLE) AS avg_fare
          FROM ${snapshot} ${predicate} GROUP BY 1 ORDER BY trips DESC`,
              ),
            },
            { concurrency: 3 },
          ).pipe(
            Effect.map((data) => ({
              ...data,
              queriedAt: new Date().toISOString(),
            })),
            Effect.withSpan("analytics.overview"),
          );
        },
        {
          capacity: 64,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? "60 seconds" : 0),
        },
      );

      const trips = (search: TripSearch) => {
        const page = search.page ?? 1;
        const order =
          search.sort === "fare"
            ? sql`fare_amount DESC`
            : search.sort === "distance"
              ? sql`trip_distance DESC`
              : sql`tpep_pickup_datetime DESC`;
        const predicate = where(search);
        return Effect.all(
          {
            rows: read(
              Trip,
              sql`SELECT CAST(trip_id AS STRING) AS trip_id,
          CAST(tpep_pickup_datetime AS STRING) AS pickup_at,
          CAST(tpep_dropoff_datetime AS STRING) AS dropoff_at,
          COALESCE(CAST(pickup_zip AS STRING),'Unknown') AS pickup_zip,
          COALESCE(CAST(dropoff_zip AS STRING),'Unknown') AS dropoff_zip,
          CAST(COALESCE(trip_distance,0) AS DOUBLE) AS distance,
          CAST(COALESCE(fare_amount,0) AS DOUBLE) AS fare,
          CAST(COALESCE(timestampdiff(SECOND,tpep_pickup_datetime,tpep_dropoff_datetime)/60.0,0) AS DOUBLE) AS duration
          FROM ${snapshot} ${predicate}
          ORDER BY ${order}, tpep_pickup_datetime DESC, tpep_dropoff_datetime DESC, pickup_zip, dropoff_zip, fare_amount, trip_distance, trip_id
          LIMIT 25 OFFSET ${sql.param("INT", String((page - 1) * 25))}`,
            ),
            total: read(
              Schema.Struct({ total: Schema.Number }),
              sql`SELECT CAST(COUNT(*) AS DOUBLE) AS total FROM ${snapshot} ${predicate}`,
            ).pipe(Effect.map((rows) => rows[0]?.total ?? 0)),
          },
          { concurrency: 2 },
        ).pipe(
          Effect.map((data) => ({ ...data, page, pageSize: 25 })),
          Effect.withSpan("analytics.trips"),
        );
      };
      return {
        availability: capability.availability,
        metadata,
        overview: (filters: Filters) =>
          Cache.get(
            overviewCache,
            JSON.stringify({
              from: filters.from,
              to: filters.to,
              zip: filters.zip,
            }),
          ),
        trips,
      };
    }).pipe(Effect.provide(Reactivity.layer)),
  );
}
