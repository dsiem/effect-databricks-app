# SQL Warehouse Adapter for Effect

Query a Databricks SQL warehouse from Node.js 22.19+ with Effect `~4.1.4`. The adapter provides Effect's `SqlClient` for rows and `DatabricksClient` for Apache Arrow results.

This project is independently maintained and is not affiliated with or endorsed by Databricks, Inc.

## Install from this workspace

Run `npm ci` and `npm pack --workspace @dsiem/sql-warehouse --pack-destination /tmp` at the repository root. In your application, run `npm install /tmp/dsiem-sql-warehouse-0.1.0.tgz effect@4.1.4`.

## A small query helper

`countRows` quotes the table identifier and decodes the warehouse count as a `bigint`. The helper only needs Effect's `SqlClient`. Supply the Databricks layer once at application startup.

```ts
import { Config, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { DatabricksClient } from "@dsiem/sql-warehouse";

const countRows = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ total: Schema.BigInt }),
  execute: (table) =>
    SqlClient.use((sql) => sql`SELECT COUNT(*) AS total FROM ${sql(table)}`),
});

const Warehouse = Layer.unwrap(
  Effect.gen(function* () {
    return DatabricksClient.layer({
      host: yield* Config.String("DATABRICKS_HOST"),
      warehouseId: yield* Config.String("DATABRICKS_WAREHOUSE_ID"),
      accessToken: Effect.succeed(yield* Config.Redacted("DATABRICKS_TOKEN")),
    });
  }),
);

const { total } = await Effect.runPromise(
  countRows("samples.nyctaxi.trips").pipe(Effect.provide(Warehouse)),
);
console.log(total);
```

Use a table your identity can read. For OAuth, create one `Credentials.clientCredentials(...)` provider per identity and pass it as `accessToken`. To reuse your Effect HTTP middleware for warehouse requests, pass its client as `workspaceHttpClient`. Configure it to send each submission once. Signed storage downloads use a separate fetch client.

## Arrow and Spark SQL

- Use `sql.arrow(statement)` for a table or `sql.arrowStream(statement)` for record batches. The adapter buffers one result chunk at a time when streaming. Each element of `sql.ipcStream(statement, { maxBytes })` is an independent IPC stream. Wrap downstream processing in `sql.withQueryTimeout` to include it in the deadline.
- Bind values with template substitutions. For an explicit type, use `sql.param("DATE", "2026-11-19")`, including inside `sql.in([...])`.
- Execute independent statements. Sessions, reserved connections, and transactions are unsupported. For bulk updates, `sql.updateValues` is unsupported. Write Spark SQL such as `UPDATE orders SET status = ${status} WHERE id = ${id}` inside the SQL template. Use `onDialectOrElse` to select Spark's fallback branch.
- A lost submission response can leave a write committed. Check the warehouse outcome before resubmitting. Ambiguous timeouts are non-retryable `SqlError`s. `error.reason.operation` identifies the phase, `error.reason.cause.reason` holds `"StatementTimeoutError"`, and `error.reason.cause.statementId` holds the ID when available.
