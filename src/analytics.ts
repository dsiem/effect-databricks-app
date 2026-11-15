import { Cache, Context, Effect, Exit, Layer, Schema } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import { AuthenticationError, SqlError } from "effect/sql/SqlError";
import * as SqlSchema from "effect/sql/SqlSchema";
import { DatabricksClient } from "effect-sql-databricks";
import {
  type CapabilityAvailability,
  Daily,
  type Filters,
  type GpsActivity,
  GpsCell,
  type GpsSearch,
  Hourly,
  Metadata,
  type Overview,
  Summary,
  Trip,
  TripDetails,
  type TripSearch,
  type Trips,
  Zone,
} from "../shared/domain.js";
import { makeAdmission } from "./admission.js";
import { makeCapability } from "./capability.js";
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
    readonly gpsActivity: (
      search: typeof GpsSearch.Type,
    ) => Effect.Effect<GpsActivity, ServiceError>;
  }
>()("app/Analytics") {
  static readonly layer = Layer.effect(
    Analytics,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const workspace = yield* Workspace;
      const configured = !!(
        settings.warehouseId &&
        settings.host &&
        settings.tripSnapshotTable
      );
      const [catalog = "unconfigured", schema = "snapshot", table = "trips"] =
        settings.tripSnapshotTable
          ? settings.tripSnapshotTable.split(".")
          : ["unconfigured", "snapshot", "trips"];
      const capability = makeCapability(configured);
      const admit = makeAdmission({
        service: "warehouse",
        concurrency: settings.warehouseConcurrency,
        timeout: "90 seconds",
      });
      const error = unavailable(
        "warehouse",
        configured
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
              Schema.Struct({
                ...Trip.fields,
                details: Schema.fromJsonString(TripDetails),
              }),
              sql`SELECT CAST(trip_id AS STRING) AS trip_id,
          CAST(tpep_pickup_datetime AS STRING) AS pickup_at,
          CAST(tpep_dropoff_datetime AS STRING) AS dropoff_at,
          COALESCE(CAST(pickup_zip AS STRING),'Unknown') AS pickup_zip,
          COALESCE(CAST(dropoff_zip AS STRING),'Unknown') AS dropoff_zip,
          CAST(COALESCE(trip_distance,0) AS DOUBLE) AS distance,
          CAST(COALESCE(fare_amount,0) AS DOUBLE) AS fare,
          CAST(COALESCE(timestampdiff(SECOND,tpep_pickup_datetime,tpep_dropoff_datetime)/60.0,0) AS DOUBLE) AS duration,
          to_json(named_struct(
            'source_file', source_file, 'vendor_id', VendorID,
            'passenger_count', passenger_count, 'rate_code_id', RatecodeID,
            'store_and_fwd_flag', store_and_fwd_flag, 'payment_type', payment_type,
            'pickup_location', CASE WHEN pickup_coordinates_valid THEN named_struct('longitude', pickup_longitude, 'latitude', pickup_latitude) END,
            'dropoff_location', CASE WHEN dropoff_coordinates_valid THEN named_struct('longitude', dropoff_longitude, 'latitude', dropoff_latitude) END,
            'tip_amount', CASE WHEN abs(tip_amount) < double('Infinity') THEN tip_amount END,
            'tolls_amount', CASE WHEN abs(tolls_amount) < double('Infinity') THEN tolls_amount END,
            'extra', CASE WHEN abs(extra) < double('Infinity') THEN extra END,
            'mta_tax', CASE WHEN abs(mta_tax) < double('Infinity') THEN mta_tax END,
            'improvement_surcharge', CASE WHEN abs(improvement_surcharge) < double('Infinity') THEN improvement_surcharge END,
            'total_amount', CASE WHEN abs(total_amount) < double('Infinity') THEN total_amount END
          ), map('ignoreNullFields', 'false')) AS details
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
      const gpsCache = yield* Cache.makeWith(
        (key: string) => {
          const search = JSON.parse(key) as typeof GpsSearch.Type;
          const endpoint = search.endpoint ?? "pickup";
          const longitude =
            endpoint === "pickup"
              ? sql`pickup_longitude`
              : sql`dropoff_longitude`;
          const latitude =
            endpoint === "pickup"
              ? sql`pickup_latitude`
              : sql`dropoff_latitude`;
          const valid =
            endpoint === "pickup"
              ? sql`pickup_coordinates_valid`
              : sql`dropoff_coordinates_valid`;
          const zip =
            endpoint === "pickup" ? sql`pickup_zip` : sql`dropoff_zip`;
          return Effect.all(
            {
              totals: read(
                Schema.Struct({
                  matching: Schema.Number,
                  located: Schema.Number,
                }),
                sql`SELECT COUNT(*)::DOUBLE AS matching, count_if(${valid})::DOUBLE AS located FROM ${snapshot} ${where(search)}`,
              ),
              cells: read(
                Schema.Struct({
                  ...GpsCell.fields,
                  boundary: Schema.fromJsonString(GpsCell.fields.boundary),
                  total_cells: Schema.Number,
                }),
                sql`WITH bins AS (
            SELECT h3_longlatash3(${longitude}, ${latitude}, 10) AS cell,
              COUNT(*)::DOUBLE AS trips, AVG(fare_amount) AS avg_fare,
              AVG(trip_distance) AS avg_distance, mode(${zip}, true) AS zip
            FROM ${snapshot} ${where(search)} AND ${valid} GROUP BY 1
          ) SELECT h3_h3tostring(cell) AS id,
            (h3_centerasgeojson(cell):coordinates[0])::DOUBLE AS longitude,
            (h3_centerasgeojson(cell):coordinates[1])::DOUBLE AS latitude,
            h3_boundaryasgeojson(cell) AS boundary, trips, avg_fare, avg_distance, zip,
            COUNT(*) OVER()::DOUBLE AS total_cells
          FROM bins ORDER BY trips DESC, cell LIMIT 100001`,
              ),
            },
            { concurrency: 2 },
          ).pipe(
            Effect.map(({ totals, cells }): GpsActivity => {
              const shown = cells.slice(0, 100000);
              return {
                endpoint,
                matchingTrips: totals[0]?.matching ?? 0,
                locatedTrips: totals[0]?.located ?? 0,
                shownTrips: shown.reduce((sum, cell) => sum + cell.trips, 0),
                totalCells: cells[0]?.total_cells ?? 0,
                truncated: cells.length > 100000,
                cells: shown.map(({ total_cells: _, ...cell }) => cell),
                queriedAt: new Date().toISOString(),
              };
            }),
          );
        },
        {
          capacity: 16,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? "5 minutes" : 0),
        },
      );
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
        gpsActivity: (search: typeof GpsSearch.Type) =>
          Cache.get(
            gpsCache,
            JSON.stringify({
              from: search.from,
              to: search.to,
              zip: search.zip,
              endpoint: search.endpoint ?? "pickup",
            }),
          ),
      };
    }).pipe(Effect.provide(Reactivity.layer)),
  );
}
