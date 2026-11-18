import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const operation = process.argv[2];
const target = process.env.BUNDLE_TARGET;
const host = process.env.DATABRICKS_HOST;
if (!target || !host || !["bootstrap", "local-env"].includes(operation)) {
  throw new Error(
    "Use databricks bundle run bootstrap or local_env with a target.",
  );
}

const json = (...args) =>
  JSON.parse(
    execFileSync("databricks", [...args, "-o", "json"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
const bundle = (command, ...args) =>
  execFileSync("databricks", ["bundle", command, "-t", target, ...args], {
    stdio: "inherit",
  });

if (operation === "bootstrap") {
  execFileSync("npm", ["run", "build", "--workspaces", "--if-present"], {
    stdio: "inherit",
  });
  bundle("deploy", "--select", "jobs.seed_trip_snapshot");
  bundle("run", "seed_trip_snapshot");
  bundle("deploy");
}

const { resources } = json("bundle", "summary", "-t", target);
const endpointName = resources.postgres_endpoints?.notebook_endpoint?.id;
const identity = json("current-user", "me");
if (!endpointName || !identity.userName) {
  throw new Error("Missing the Lakebase endpoint or workspace identity.");
}

if (operation === "bootstrap") {
  const appName = resources.apps?.app?.name;
  if (!appName) throw new Error("Missing the deployed app in bundle state.");
  const app = json("apps", "get", appName);
  const principal = app.service_principal_client_id;
  if (!principal)
    throw new Error("Missing the deployed app service principal.");
  bundle(
    "run",
    "grant_trip_access",
    "--params",
    `app_service_principal_id=${principal}`,
  );
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/setup-lakebase.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        APP_SERVICE_PRINCIPAL_ID: principal,
        LAKEBASE_ENDPOINT: endpointName,
        PGHOST: "",
        PGPORT: "5432",
        PGDATABASE: "databricks_postgres",
        PGUSER: identity.userName,
        PGPASSWORD: "",
      },
    },
  );
  bundle("run", "app");
} else {
  const schema = resources.schemas?.data;
  const endpoint = json("postgres", "get-endpoint", endpointName);
  const values = {
    DATABRICKS_HOST: host,
    DATABRICKS_WAREHOUSE_ID: resources.sql_warehouses?.analytics?.id,
    TRIP_SNAPSHOT_TABLE:
      schema?.catalog_name &&
      schema.name &&
      `${schema.catalog_name}.${schema.name}.trips`,
    ANALYSIS_JOB_ID: resources.jobs?.route_reliability?.id,
    ANALYSIS_RESULTS_TABLE:
      schema?.catalog_name &&
      schema.name &&
      `${schema.catalog_name}.${schema.name}.route_reliability_runs`,
    GENIE_SPACE_ID: resources.genie_spaces?.taxi?.id,
    LAKEBASE_ENDPOINT: endpointName,
    PGHOST: endpoint.status?.hosts?.host,
    PGDATABASE: "databricks_postgres",
    PGUSER: identity.userName,
  };
  let env = readFileSync(existsSync(".env") ? ".env" : ".env.example", "utf8");
  for (const [key, value] of Object.entries(values)) {
    if (!value) throw new Error(`Missing bundle value for ${key}.`);
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    env = pattern.test(env)
      ? env.replace(pattern, () => line)
      : `${env.trimEnd()}\n${line}\n`;
  }
  writeFileSync(".env", env, { mode: 0o600 });
  console.log(`Wrote local connection settings for ${target} to .env`);
}
