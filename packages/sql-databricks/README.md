# effect-sql-databricks

A standalone ESM adapter for **Effect 4.1.4** and Databricks SQL warehouses. It
uses the [Statement Execution API](https://docs.databricks.com/api/statement-execution/v1/statement-execution)
with `ARROW_STREAM` / `EXTERNAL_LINKS` and decodes the returned IPC with
`apache-arrow`. The Arrow APIs preserve columnar values without converting them
to JavaScript row objects. No change to Effect core is required.

This package lives in the application's npm workspace and is not published to a
registry. Run `npm install` at the repository root to link it locally. To use it
in another project, build and pack it here, then install the resulting tarball:

```sh
npm pack --workspace effect-sql-databricks --pack-destination /tmp
# In the consuming project:
npm install /tmp/effect-sql-databricks-0.1.0.tgz effect@4.1.4
```

## Query an Arrow table

```ts
import { Config, Effect } from "effect";
import { DatabricksClient } from "effect-sql-databricks";

const program = Effect.gen(function* () {
  const host = yield* Config.String("DATABRICKS_HOST");
  const warehouseId = yield* Config.String("DATABRICKS_WAREHOUSE_ID");
  const token = yield* Config.Redacted("DATABRICKS_TOKEN");

  return yield* Effect.gen(function* () {
    const sql = yield* DatabricksClient.DatabricksClient;
    const statement = sql`
      SELECT sale_date, SUM(amount) AS revenue
      FROM ${sql("main.analytics.sales")}
      WHERE sale_date >= ${sql.param("DATE", "2026-01-01")}
      GROUP BY sale_date ORDER BY sale_date
    `;
    return yield* sql.arrow(statement); // apache-arrow Table
  }).pipe(
    Effect.provide(
      DatabricksClient.layer({
        host,
        warehouseId,
        accessToken: Effect.succeed(token),
      }),
    ),
  );
});

const table = await Effect.runPromise(program);
console.log(
  table.numRows,
  table.schema.fields.map((field) => field.name),
);
```

Values in templates become named parameters (`:p1`, `:p2`, ...), not SQL text.
`sql("catalog.schema.table")` quotes each identifier component with backticks.
Strings, booleans, finite numbers, safe integers, bigint, Date, and null/undefined
are supported. Integers bind as BIGINT, fractional numbers as DOUBLE, and Date as
TIMESTAMP. Use `sql.param("DECIMAL(38,2)", "12345678901234567890.12")` for exact
decimals and `sql.param("DATE", null)` for typed nulls. Complex parameter objects
and unsafe integer numbers fail before submission.

## Choose a result shape

Given `const statement = sql\`SELECT ...\``:

| API                          | Result                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `sql.arrow(statement)`       | `Effect<Table, SqlError>`; materializes the whole result             |
| `sql.arrowChunks(statement)` | `Stream<Table, SqlError>`; one table per Databricks chunk            |
| `sql.arrowStream(statement)` | `Stream<RecordBatch, SqlError>`; columnar record batches             |
| `sql.ipcStream(statement)`   | `Stream<Uint8Array, SqlError>`; one independent IPC stream per chunk |
| `yield* statement`           | Standard Effect SQL row objects, decoded from Arrow                  |
| `statement.stream`           | Standard Effect SQL row stream                                       |
| `statement.values`           | Values in SQL column order                                           |
| `statement.raw`              | Arrow `Table`, typed as `unknown` by Effect's generic raw contract   |

The layer also provides `SqlClient.SqlClient` from `effect/sql/SqlClient` for
generic Effect SQL consumers. Native Arrow methods accept a compiled Effect
statement and are typed on the driver service.

For a browser, relay each `ipcStream` element as a separate binary response, or
decode Arrow chunks and re-encode one valid IPC stream. **Do not concatenate the
independent IPC streams**. Perspective can consume Arrow directly; custom charts
and grids can select columns or adapt only the rows needed for rendering. Keep
warehouse access and credentials in the backend.

## Authentication

`accessToken` is an Effect evaluated for each workspace request. Supply an
existing token provider, a forwarded user token when using Databricks user
authorization, or the included OAuth M2M provider:

```ts
import { Credentials, DatabricksClient } from "effect-sql-databricks";

const accessToken = Credentials.clientCredentials({
  host,
  clientId,
  clientSecret, // Redacted<string>
});
const live = DatabricksClient.layer({ host, warehouseId, accessToken });
```

Create the provider once per identity. It requests the `sql` scope, caches tokens
until shortly before their advertised expiry, and shares concurrent refreshes.
Databricks Apps supplies `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` for
its app identity. That identity needs warehouse `CAN_USE`, plus `USE CATALOG`,
`USE SCHEMA`, and `SELECT` on the queried Unity Catalog objects. App identity
access gives viewers the app's permissions; use user authorization when each
viewer's policies must apply.

Signed result URLs never receive workspace authorization or cookies. They are
resolved as chunks are consumed, and refreshed once on HTTP 401/403. Errors from
networking and response decoding omit raw responses and URLs. Query execution
failures preserve the server's SQL error message, which may contain query text;
treat those messages accordingly.

## Lifecycle and limits

- `queryTimeout` defaults to two minutes for the complete stream, including
  downstream consumption. `requestTimeout` defaults to 30 seconds per request,
  including reading its body. `pollInterval` defaults to 250 milliseconds.
- Running statements are canceled when the stream fails, times out, or is
  interrupted. Cancellation is best effort, bounded to five seconds; a submission
  whose response is lost may have executed without returning an ID to cancel.
- Transient workspace GET failures retry twice. SQL submissions never retry
  automatically, because a lost response can leave the execution outcome unknown.
- Streaming buffers one complete Databricks result chunk at a time. Record batches
  are emitted from that chunk. It does not decode network bytes incrementally.
  `arrow`, ordinary row queries, and `values` materialize the full result.
- An optional `byteLimit` is sent to Databricks. A truncated result fails rather
  than returning a partial table. Queries with no chunks return a zero-column
  empty table; an Arrow chunk with zero rows preserves its schema.
- Independent REST statements have no shared session. `withTransaction` and
  `reserve` fail explicitly. Transactions, `updateValues`, custom fragments, and
  database-specific migration helpers are outside this adapter's scope.
- Effect 4.1's closed compiler dialect union has no Spark entry. The compiler uses
  its MySQL discriminator for generic helpers, with Spark backtick identifiers
  and REST named parameters. Avoid dialect-switching helpers and write Spark SQL.
- Workspace and download URLs require HTTPS, except loopback HTTP for local
  development. External-link downloads must be enabled for the workspace.

## Verification

```sh
npm run check                       # at repository root; includes this package
npm test --workspace effect-sql-databricks
npm run smoke:live --workspace effect-sql-databricks
```

The integration suite runs a local SQL API and separate storage HTTP server with
real Arrow IPC payloads, without workspace credentials. The live smoke builds the
package and runs a fixed, read-only SELECT to check BIGINT precision, NULL,
DECIMAL, and parameter binding. It needs `DATABRICKS_HOST` and
`DATABRICKS_WAREHOUSE_ID`, plus either `DATABRICKS_TOKEN` or OAuth client ID/secret.
It prints no query data, tokens, or signed URLs.

References: [Arrow JavaScript](https://arrow.apache.org/js/current/),
[OAuth M2M](https://docs.databricks.com/aws/en/dev-tools/auth/oauth-m2m),
[Databricks Apps authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth).
