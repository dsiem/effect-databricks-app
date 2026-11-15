import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? "dev";
const cli = (args) =>
  JSON.parse(
    execFileSync("databricks", [...args, "-o", "json"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
const resources = cli(["bundle", "summary", "-t", target]).resources;
const { catalog_name: catalog, name: schema } = resources.schemas.data;
const app = cli(["apps", "get", resources.apps.app.name]);
if (
  ![catalog, schema].every((part) =>
    /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(part),
  )
)
  throw new Error("Invalid dataset catalog/schema");
const parameters = Object.entries({
  catalog,
  schema,
  app_service_principal_id: app.service_principal_client_id,
}).map(([name, value]) => ({ name, value, type: "STRING" }));
const api = (method, path, body) =>
  cli(["api", method, path, ...(body ? ["--json", JSON.stringify(body)] : [])]);
let active;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    if (active) api("post", `/api/2.0/sql/statements/${active}/cancel`);
    process.exit(130);
  });
async function execute(statement, label) {
  console.log(`Preparing taxi data: ${label}`);
  let result = api("post", "/api/2.0/sql/statements", {
    warehouse_id: resources.sql_warehouses.analytics.id,
    statement,
    parameters,
    wait_timeout: "10s",
    on_wait_timeout: "CONTINUE",
    row_limit: 100,
  });
  active = result.statement_id;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (["PENDING", "RUNNING"].includes(result.status.state)) {
    if (Date.now() > deadline) {
      api("post", `/api/2.0/sql/statements/${active}/cancel`);
      throw new Error(`Taxi data step timed out: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = api("get", `/api/2.0/sql/statements/${active}`);
  }
  active = undefined;
  if (result.status.state !== "SUCCEEDED")
    throw new Error(`${label}: ${JSON.stringify(result.status)}`);
  if (result.result?.data_array)
    console.log(JSON.stringify(result.result.data_array));
  return result;
}
await execute(
  `CREATE VOLUME IF NOT EXISTS \`${catalog}\`.\`${schema}\`.taxi_sources`,
  "source volume",
);
execFileSync(
  "databricks",
  [
    "fs",
    "cp",
    "jobs/nyc-zcta.jsonl",
    `dbfs:/Volumes/${catalog}/${schema}/taxi_sources/nyc-zcta.jsonl`,
    "--overwrite",
  ],
  { stdio: "inherit" },
);
const cells = readFileSync("jobs/seed-trip-snapshot.sql", "utf8").split(
  /-- COMMAND -+\s*\n/,
);
let report;
for (const [index, cell] of cells.entries())
  report = await execute(cell, `step ${index + 1}/${cells.length}`);
writeFileSync(
  ".databricks/taxi-ingestion-report.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      table: `${catalog}.${schema}.trips_2016`,
      columns: report.manifest.schema.columns,
      rows: report.result.data_array,
    },
    null,
    2,
  ),
);
console.log(`Taxi dataset ready: ${catalog}.${schema}.trips_2016`);
