# Query Databricks SQL with Effect

Use `effect-sql-databricks` for Effect SQL queries and Arrow results over the
[Statement Execution API](https://docs.databricks.com/api/statement-execution/v1/statement-execution).
The package requires Effect `~4.1.4` and is distributed from this repository.

## Install the package

From the repository root, pack the adapter:

```sh
npm ci
npm pack --workspace effect-sql-databricks --pack-destination /tmp
```

In the consuming project, install the tarball and Effect:

```sh
npm install /tmp/effect-sql-databricks-0.1.0.tgz effect@4.1.4
```

## Run a query

Set `DATABRICKS_HOST`, `DATABRICKS_WAREHOUSE_ID`, and `DATABRICKS_TOKEN` in the server
environment. Run this program in that environment:

```ts
import { Config, Effect } from "effect";
import { DatabricksClient } from "effect-sql-databricks";

const program = Effect.gen(function* () {
	const host = yield* Config.String("DATABRICKS_HOST");
	const warehouseId = yield* Config.String("DATABRICKS_WAREHOUSE_ID");
	const token = yield* Config.Redacted("DATABRICKS_TOKEN");
	return yield* Effect.gen(function* () {
		const sql = yield* DatabricksClient.DatabricksClient;
		return yield* sql.arrow(sql`SELECT ${42} AS answer`);
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
console.log(table.getChild("answer")?.get(0));
```

Expect `42n`, an Arrow BIGINT value. To query a table, use
`sql("catalog.schema.table")` for its identifier.
Keep values in template substitutions so the adapter binds parameters. For dates,
use `sql.param("DATE", "2016-01-01")`. Use `SqlSchema` to validate application rows.

For renewable OAuth credentials, pass one `Credentials.clientCredentials`
provider as `accessToken`. Import `Credentials` from `effect-sql-databricks`.
Keep the provider and warehouse access on the server.

## Consume larger results

Use `sql.arrowChunks(statement)` for Arrow tables by result chunk, or
`sql.arrowStream(statement)` for record batches. Each chunk is buffered before
decoding. To include downstream work in the query deadline, wrap the consuming
Effect with `sql.withQueryTimeout`.

Use `sql.ipcStream(statement)` for independent Arrow IPC chunks. Relay chunks
separately. Do not concatenate them into one IPC stream.

Write independent Spark SQL statements. The adapter does not provide sessions or
transactions. After a timeout, check the outcome before retrying a write.
Use the exported TypeScript declarations to inspect all methods and options.
