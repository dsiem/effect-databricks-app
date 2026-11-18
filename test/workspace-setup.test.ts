import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const principal = "472a6613-2337-4af1-a416-e9b6b61064dd";
const endpointName = "projects/test/branches/production/endpoints/primary";

const fakeCommands = `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
childProcess.execFileSync = (file, args, options) => {
  const command = args.join(" ");
  console.log("CALL " + command);
  if (command.startsWith("bundle summary")) return JSON.stringify({ resources: {
    apps: { app: { name: "test-app" } },
    sql_warehouses: { analytics: { id: "warehouse" } },
    schemas: { data: { catalog_name: "seed_catalog", name: "seed-schema" } },
    jobs: { route_reliability: { id: 123456 } },
    genie_spaces: { taxi: { id: "genie" } },
    postgres_endpoints: { notebook_endpoint: { id: "${endpointName}" } },
  } });
  if (command.startsWith("postgres get-endpoint")) return JSON.stringify({ status: { hosts: { host: "postgres.invalid" } } });
  if (command.startsWith("apps get")) return JSON.stringify({ service_principal_client_id: "${principal}" });
  if (command.startsWith("current-user me")) return JSON.stringify({ userName: "deployer@example.com" });
  if (args[0] === "--import") {
    console.log("LAKEBASE " + JSON.stringify({
      host: options.env.PGHOST, principal: options.env.APP_SERVICE_PRINCIPAL_ID,
      endpoint: options.env.LAKEBASE_ENDPOINT, user: options.env.PGUSER,
    }));
  }
  if (command === process.env.SETUP_FAILURE) throw new Error("Fixture command failed");
  return "";
};
syncBuiltinESMExports();
process.argv[2] = process.env.SETUP_OPERATION;
await import(process.env.SETUP_ENTRY_POINT);
`;

async function setup(t: TestContext, operation: string, failure = "") {
  const directory = await mkdtemp(join(tmpdir(), "workspace-setup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const localEnv = "DATABRICKS_HOST=https://local.invalid\nKEEP_ME=yes\n";
  const envPath = join(directory, ".env");
  await writeFile(envPath, localEnv);
  let stdout: string;
  try {
    const result = await run(
      process.execPath,
      ["--input-type=module", "-e", fakeCommands],
      {
        cwd: directory,
        env: {
          ...process.env,
          BUNDLE_TARGET: "prod",
          DATABRICKS_HOST: "https://workspace.invalid",
          PGHOST: "local.invalid",
          SETUP_OPERATION: operation,
          SETUP_FAILURE: failure,
          SETUP_ENTRY_POINT: new URL(
            "../scripts/setup-workspace.mjs",
            import.meta.url,
          ).href,
        },
        timeout: 15_000,
      },
    );
    assert.equal(failure, "");
    stdout = result.stdout;
  } catch (error) {
    assert.ok(failure);
    assert.ok(error instanceof Error && "stdout" in error);
    assert.match(error.message, /Fixture command failed/);
    stdout = String(error.stdout);
  }
  const calls = stdout
    .split("\n")
    .filter((line) => line.startsWith("CALL "))
    .map((line) => line.slice(5));
  const lakebase = stdout
    .split("\n")
    .find((line) => line.startsWith("LAKEBASE "));
  return { calls, lakebase, env: await readFile(envPath, "utf8"), localEnv };
}

const lakebaseCommand = "--import tsx scripts/setup-lakebase.ts";
const bootstrapCalls = [
  "run build --workspaces --if-present",
  "bundle deploy -t prod --select jobs.seed_trip_snapshot",
  "bundle run -t prod seed_trip_snapshot",
  "bundle deploy -t prod",
  "bundle summary -t prod -o json",
  "current-user me -o json",
  "apps get test-app -o json",
  `bundle run -t prod grant_trip_access --params app_service_principal_id=${principal}`,
  lakebaseCommand,
  "bundle run -t prod app",
];

test("bootstrap seeds before creating Genie and the app, then grants access before starting it", async (t) => {
  const result = await setup(t, "bootstrap");
  assert.deepEqual(result.calls, bootstrapCalls);
  assert.equal(
    result.lakebase,
    "LAKEBASE " +
      JSON.stringify({
        host: "",
        principal,
        endpoint: endpointName,
        user: "deployer@example.com",
      }),
  );
  assert.equal(result.env, result.localEnv);
});

for (const failedCommand of [
  bootstrapCalls[2]!,
  bootstrapCalls[7]!,
  lakebaseCommand,
]) {
  test(`bootstrap stops after ${failedCommand} fails`, async (t) => {
    const result = await setup(t, "bootstrap", failedCommand);
    assert.deepEqual(
      result.calls,
      bootstrapCalls.slice(0, bootstrapCalls.indexOf(failedCommand) + 1),
    );
    assert.equal(result.env, result.localEnv);
  });
}

test("local_env writes the selected bundle settings without deploying anything", async (t) => {
  const result = await setup(t, "local-env");
  assert.deepEqual(result.calls, [
    "bundle summary -t prod -o json",
    "current-user me -o json",
    `postgres get-endpoint ${endpointName} -o json`,
  ]);
  assert.ok(result.env.includes("DATABRICKS_HOST=https://workspace.invalid\n"));
  assert.ok(result.env.includes("KEEP_ME=yes\n"));
  assert.ok(
    result.env.includes(
      "TRIP_SNAPSHOT_TABLE=seed_catalog.seed-schema.trips_2016\n",
    ),
  );
  assert.ok(result.env.includes("ANALYSIS_JOB_ID=123456\n"));
  assert.ok(
    result.env.includes(
      "ANALYSIS_RESULTS_TABLE=seed_catalog.seed-schema.route_reliability_runs\n",
    ),
  );
});
