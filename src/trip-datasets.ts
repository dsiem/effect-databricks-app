import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";
import type { Fragment } from "effect/sql/Statement";
import type { DatabricksClient } from "effect-sql-databricks";
import { TripDetails, TripSummary } from "../shared/domain.js";
import {
  type DatasetBudget,
  retentionCharge,
  serverWindowSize,
  type TripDataset,
  type TripDetailInput,
  TripQuery,
  type TripWindowInput,
  tripQueryKey,
} from "../shared/trip-dataset.js";
import {
  InvalidRequest,
  OperationTimeout,
  type ServiceError,
  unavailable,
} from "./errors.js";

const Snapshot = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expires: Schema.Number,
});
type Snapshot = typeof Snapshot.Type;
const Cursor = Schema.Struct({
  ...Snapshot.fields,
  query: TripQuery,
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  anchor: TripSummary,
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  direction: Schema.Literals(["next", "previous"]),
});
type Cursor = typeof Cursor.Type;
type Read = <A>(
  schema: Schema.Decoder<A>,
  statement: Effect.Effect<ReadonlyArray<unknown>, unknown>,
) => Effect.Effect<ReadonlyArray<A>, ServiceError>;

export function makeTripDatasets(
  sql: DatabricksClient.DatabricksClient,
  table: Fragment,
  read: Read,
  budget: DatasetBudget,
) {
  // Restart invalidates continuations; clients recover by opening a fresh dataset.
  const secret = randomBytes(32);
  const windowSize = serverWindowSize(budget);
  const sign = <A extends Snapshot>(data: A) => {
    const body = Buffer.from(JSON.stringify(data)).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const verify = <A extends Snapshot>(
    token: string,
    schema: Schema.Decoder<A>,
  ) =>
    Effect.try({
      try: () => {
        const pieces = token.split(".");
        if (pieces.length !== 2) throw new Error("token");
        const [body = "", signature = ""] = pieces;
        const expected = createHmac("sha256", secret).update(body).digest();
        const received = Buffer.from(signature, "base64url");
        if (
          received.length !== expected.length ||
          !timingSafeEqual(expected, received)
        )
          throw new Error("signature");
        const data = Schema.decodeUnknownSync(schema)(
          JSON.parse(Buffer.from(body, "base64url").toString()),
        );
        if (data.expires < Date.now()) throw new Error("expired");
        return data;
      },
      catch: () =>
        new InvalidRequest({
          message: "This dataset has expired. Reload the trips to continue.",
        }),
    });
  const source = (version: number) =>
    sql`${table} VERSION AS OF ${sql.literal(String(version))}`;
  const projection =
    () => sql`CAST(trip_id AS STRING) COLLATE UTF8_BINARY AS trip_id,
    date_format(tpep_pickup_datetime, 'yyyy-MM-dd HH:mm:ss.SSSSSS') AS pickup_at,
    date_format(tpep_dropoff_datetime, 'yyyy-MM-dd HH:mm:ss.SSSSSS') AS dropoff_at,
    CAST(pickup_zip AS STRING) AS pickup_zip, CAST(dropoff_zip AS STRING) AS dropoff_zip,
    CAST(trip_distance AS DOUBLE) AS distance, CAST(fare_amount AS DOUBLE) AS fare,
    CAST(timestampdiff(SECOND, tpep_pickup_datetime, tpep_dropoff_datetime)/60.0 AS DOUBLE) AS duration`;
  const where = ({ filters }: TripQuery) => sql`WHERE 1=1
    ${filters.from ? sql`AND CAST(tpep_pickup_datetime AS DATE) >= ${sql.param("DATE", filters.from)}` : sql``}
    ${filters.to ? sql`AND CAST(tpep_pickup_datetime AS DATE) <= ${sql.param("DATE", filters.to)}` : sql``}
    ${filters.zip ? sql`AND CAST(pickup_zip AS STRING) COLLATE UTF8_BINARY = ${filters.zip}` : sql``}`;
  const primary = (query: TripQuery) =>
    query.sort === "fare"
      ? sql`fare`
      : query.sort === "distance"
        ? sql`distance`
        : sql`pickup_at`;
  const selectStatement = (
    query: TripQuery,
    version: number,
    limit: number,
    cursor?: Cursor,
  ) => {
    const column = primary(query);
    const anchor = cursor?.anchor;
    const value =
      anchor &&
      (query.sort === "fare"
        ? anchor.fare
        : query.sort === "distance"
          ? anchor.distance
          : anchor.pickup_at);
    const previous = cursor?.direction === "previous";
    const comparison = previous ? sql`>` : sql`<`;
    return sql`WITH summaries AS (SELECT ${projection()} FROM ${source(version)} ${where(query)})
      SELECT * FROM summaries ${anchor ? sql`WHERE (${column} ${comparison} ${value} OR (${column} = ${value} AND trip_id ${previous ? sql`<` : sql`>`} ${anchor.trip_id}))` : sql``}
      ORDER BY ${column} ${previous ? sql`ASC` : sql`DESC`}, trip_id ${previous ? sql`DESC` : sql`ASC`}
      LIMIT ${sql.literal(String(limit))}`;
  };
  const select = (
    query: TripQuery,
    version: number,
    limit: number,
    cursor?: Cursor,
  ) =>
    read(TripSummary, selectStatement(query, version, limit, cursor)).pipe(
      Effect.map((rows) =>
        cursor?.direction === "previous" ? [...rows].reverse() : rows,
      ),
    );
  const window = (
    query: TripQuery,
    state: Snapshot,
    rows: ReadonlyArray<TripSummary>,
    total: number,
    start: number,
  ): TripDataset => {
    const retainedBytes = retentionCharge(rows);
    const base = {
      schemaVersion: 1 as const,
      query,
      queryKey: tripQueryKey(query),
      snapshot: sign({ version: state.version, expires: state.expires }),
      datasetKey: `trip-v1:${state.version}:${tripQueryKey(query)}`,
      total,
      loaded: rows.length,
      budget,
      retainedBytes,
      rows,
    };
    const last = rows.at(-1);
    return {
      ...base,
      scope: "server-window",
      start,
      previous:
        start > 0 && rows[0]
          ? sign({
              ...state,
              query,
              total,
              anchor: rows[0],
              start,
              direction: "previous",
            })
          : null,
      next:
        start + rows.length < total && last
          ? sign({
              ...state,
              query,
              total,
              anchor: last,
              start: start + rows.length,
              direction: "next",
            })
          : null,
    };
  };
  const checked = (data: TripDataset) =>
    data.retainedBytes <= budget.bytes
      ? Effect.succeed(data)
      : Effect.fail(
          unavailable(
            "warehouse",
            "The trip window exceeds the configured byte budget.",
          ),
        );
  const prepare = (query: TripQuery) =>
    Effect.gen(function* () {
      const history = yield* read(
        Schema.Struct({
          version: Schema.Union([Schema.Number, Schema.BigInt]),
        }),
        sql`DESCRIBE HISTORY ${table} LIMIT 1`,
      );
      const version = Number(history[0]?.version);
      if (!Number.isSafeInteger(version) || version < 0)
        return yield* Effect.fail(
          unavailable(
            "warehouse",
            "A Delta snapshot version is required for the explorer.",
          ),
        );
      const state = { version, expires: Date.now() + 30 * 60 * 1000 };
      const counts = yield* read(
        Schema.Struct({ total: Schema.Number }),
        sql`SELECT COUNT(*)::DOUBLE AS total FROM ${source(version)} ${where(query)}`,
      );
      const total = counts[0]?.total;
      if (total === undefined || !Number.isSafeInteger(total) || total < 0)
        return yield* Effect.fail(
          unavailable("warehouse", "The trip count is unavailable."),
        );
      return { state, total };
    });
  const open = (query: TripQuery) =>
    Effect.gen(function* () {
      const { state, total } = yield* prepare(query);
      const rows = yield* select(
        query,
        state.version,
        total <= budget.rows ? budget.rows + 1 : windowSize,
      );
      if (
        total <= budget.rows &&
        rows.length === total &&
        retentionCharge(rows) <= budget.bytes
      ) {
        const data = window(query, state, rows, total, 0);
        return { ...data, scope: "complete" as const };
      }
      if (
        rows.length !==
        Math.min(total, total <= budget.rows ? budget.rows + 1 : windowSize)
      )
        return yield* Effect.fail(
          unavailable(
            "warehouse",
            "The warehouse returned an incomplete trip result.",
          ),
        );
      return yield* checked(
        window(query, state, rows.slice(0, windowSize), total, 0),
      );
    }).pipe(
      Effect.timeoutOrElse({
        duration: "90 seconds",
        orElse: () =>
          Effect.fail(
            new OperationTimeout({
              service: "warehouse",
              message: "The trip dataset query timed out. Try again.",
            }),
          ),
      }),
      Effect.withSpan("analytics.tripDataset"),
    );
  const scroll = (input: typeof TripWindowInput.Type) =>
    Effect.gen(function* () {
      const state = yield* verify(input.cursor, Cursor);
      if (tripQueryKey(input.query) !== tripQueryKey(state.query))
        return yield* Effect.fail(
          new InvalidRequest({
            message: "The cursor does not belong to this query.",
          }),
        );
      const start =
        state.direction === "previous"
          ? Math.max(0, state.start - windowSize)
          : state.start;
      const rows = yield* select(input.query, state.version, windowSize, state);
      if (rows.length !== Math.min(windowSize, state.total - start))
        return yield* Effect.fail(
          unavailable(
            "warehouse",
            "The warehouse returned an incomplete trip window.",
          ),
        );
      return yield* checked(
        window(input.query, state, rows, state.total, start),
      );
    });
  const detail = (input: typeof TripDetailInput.Type) =>
    Effect.gen(function* () {
      const state = yield* verify(input.snapshot, Snapshot);
      const rows = yield* read(
        Schema.Struct({
          ...TripSummary.fields,
          details: Schema.fromJsonString(TripDetails),
        }),
        sql`SELECT ${projection()},
      to_json(named_struct('source_file', source_file, 'vendor_id', VendorID,
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
      FROM ${source(state.version)} WHERE trip_id = ${input.tripId} LIMIT 1`,
      );
      const row = rows[0];
      return row
        ? {
            ...row,
            pickup_zip: row.pickup_zip ?? "Unknown",
            dropoff_zip: row.dropoff_zip ?? "Unknown",
          }
        : yield* Effect.fail(
            new InvalidRequest({
              message: "This trip is absent from the selected snapshot.",
            }),
          );
    });
  return { open, scroll, detail };
}
