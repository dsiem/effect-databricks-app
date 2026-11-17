import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? "dev";
const cli = (args) =>
  JSON.parse(
    execFileSync("databricks", [...args, "-o", "json"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
execFileSync("npm", ["run", "build", "--workspaces", "--if-present"], {
  stdio: "inherit",
});
// Bundle state owns resource creation. Re-running reconciles existing resources.
execFileSync("databricks", ["bundle", "deploy", "-t", target], {
  stdio: "inherit",
});
const summary = cli(["bundle", "summary", "-t", target]);
const config = cli(["bundle", "validate", "-t", target]);
const resources = summary.resources;
const appName = resources.apps.app.name;
const warehouseId = resources.sql_warehouses.analytics.id;
const snapshotSchema = resources.schemas.data;
const analysisJobId = resources.jobs?.route_reliability?.id;
const genieId = resources.genie_spaces.taxi.id;
const endpointName = resources.postgres_endpoints.notebook_endpoint.id;
if (
  !warehouseId ||
  !snapshotSchema?.catalog_name ||
  !snapshotSchema?.name ||
  !analysisJobId ||
  !genieId ||
  !endpointName
)
  throw new Error("Bundle resource IDs are missing after deployment.");
const endpoint = cli(["postgres", "get-endpoint", endpointName]);
const app = cli(["apps", "get", appName]);
const identity = cli(["current-user", "me"]);
if (!endpoint?.status?.hosts?.host)
  throw new Error("Lakebase endpoint has no connection host.");
const datasetSchema = `${snapshotSchema.catalog_name}.${snapshotSchema.name}`;
const values = {
  DATABRICKS_HOST:
    process.env.DATABRICKS_HOST ||
    config.workspace.host ||
    cli(["auth", "describe"]).details.host,
  DATABRICKS_WAREHOUSE_ID: warehouseId,
  TRIP_SNAPSHOT_TABLE: `${datasetSchema}.trips_2016`,
  ANALYSIS_JOB_ID: String(analysisJobId),
  ANALYSIS_RESULTS_TABLE: `${datasetSchema}.route_reliability_runs`,
  GENIE_SPACE_ID: genieId,
  LAKEBASE_ENDPOINT: endpointName,
  PGHOST: endpoint.status.hosts.host,
  PGDATABASE: "databricks_postgres",
  PGUSER: identity.userName,
};
let env = readFileSync(existsSync(".env") ? ".env" : ".env.example", "utf8");
for (const [key, value] of Object.entries(values)) {
  if (typeof value !== "string" || !value)
    throw new Error(`Missing setup value: ${key}`);
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  env = pattern.test(env)
    ? env.replace(pattern, line)
    : `${env.trimEnd()}\n${line}\n`;
}
const principal = app.service_principal_client_id;
if (!principal) throw new Error("App service principal is not available yet.");
execFileSync(
  "databricks",
  [
    "fs",
    "cp",
    "jobs/nyc-zcta.jsonl",
    `dbfs:/Volumes/${snapshotSchema.catalog_name}/${snapshotSchema.name}/taxi_sources/nyc-zcta.jsonl`,
    "--overwrite",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "databricks",
  [
    "bundle",
    "run",
    "seed_trip_snapshot",
    "-t",
    target,
    "--params",
    `app_service_principal_id=${principal}`,
  ],
  { stdio: "inherit" },
);
writeFileSync(".env", env, { mode: 0o600 });
execFileSync("npm", ["run", "db:setup"], {
  stdio: "inherit",
  env: { ...process.env, APP_SERVICE_PRINCIPAL_ID: principal },
});
execFileSync("databricks", ["bundle", "run", "app", "-t", target], {
  stdio: "inherit",
});
console.log("App deployed", app.url ?? resources.apps.app.url ?? appName);
