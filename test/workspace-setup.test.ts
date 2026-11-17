import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const principal = "472a6613-2337-4af1-a416-e9b6b61064dd";

// Run the actual setup entry point in an isolated directory, replacing only
// external commands. This also checks that a failed seed never starts the app.
const commands = `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
childProcess.execFileSync = (file, args, options) => {
  console.log("CALL " + JSON.stringify({ file, args, principal: options?.env?.APP_SERVICE_PRINCIPAL_ID }));
  if (args[0] === "bundle" && args[1] === "summary") return JSON.stringify({ resources: {
    apps: { app: { name: "test-app" } },
    sql_warehouses: { analytics: { id: "warehouse" } },
    schemas: { data: { catalog_name: process.env.SETUP_CATALOG, name: process.env.SETUP_SCHEMA } },
    genie_spaces: { taxi: { id: "genie" } },
    postgres_endpoints: { notebook_endpoint: { id: "endpoint" } },
  } });
  if (args[0] === "bundle" && args[1] === "validate") return JSON.stringify({ workspace: { host: "https://workspace.invalid" } });
  if (args[0] === "postgres") return JSON.stringify({ status: { hosts: { host: "postgres.invalid" } } });
  if (args[0] === "apps") return JSON.stringify({ service_principal_client_id: "${principal}" });
  if (args[0] === "current-user") return JSON.stringify({ userName: "deployer@example.com" });
  if (process.env.SETUP_FAILURE === "seed" && args.includes("seed_trip_snapshot")) throw new Error("Fixture seed failed");
  if (process.env.SETUP_FAILURE === "Lakebase setup" && file === "npm" && args.includes("db:setup")) throw new Error("Fixture Lakebase setup failed");
  return "";
};
syncBuiltinESMExports();
process.argv[2] = "prod";
await import(process.env.SETUP_ENTRY_POINT);
`;

for (const { failure, catalog, schema } of [
  { failure: "", catalog: "seed_catalog", schema: "seed-schema" },
  { failure: "seed", catalog: "seed_catalog", schema: "seed-schema" },
  { failure: "Lakebase setup", catalog: "seed_catalog", schema: "seed-schema" },
]) {
  test(`workspace setup ${failure ? `stops after a failed ${failure}` : `initializes and starts with ${catalog}.${schema}.trips_2016`}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-setup-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, ".env.example"), "DATABRICKS_HOST=\n");
    let stdout: string;
    try {
      const result = await run(
        process.execPath,
        ["--input-type=module", "-e", commands],
        {
          cwd: directory,
          env: {
            ...process.env,
            DATABRICKS_HOST: "",
            SETUP_FAILURE: failure,
            SETUP_CATALOG: catalog,
            SETUP_SCHEMA: schema,
            SETUP_ENTRY_POINT: new URL(
              "../scripts/setup-workspace.mjs",
              import.meta.url,
            ).href,
          },
          timeout: 15_000,
        },
      );
      assert.equal(failure, "", "setup must propagate a failed command");
      stdout = result.stdout;
    } catch (error) {
      assert.ok(failure);
      assert.ok(error instanceof Error && "stdout" in error);
      assert.match(error.message, new RegExp(`Fixture ${failure} failed`));
      stdout = String(error.stdout);
    }
    const calls = stdout
      .split("\n")
      .filter((line) => line.startsWith("CALL "))
      .map(
        (line) =>
          JSON.parse(line.slice(5)) as {
            file: string;
            args: string[];
            principal?: string;
          },
      );
    const seedIndex = calls.findIndex((call) =>
      call.args.includes("seed_trip_snapshot"),
    );
    assert.ok(seedIndex >= 0);
    assert.deepEqual(calls[seedIndex], {
      file: "databricks",
      args: [
        "bundle",
        "run",
        "seed_trip_snapshot",
        "-t",
        "prod",
        "--params",
        `app_service_principal_id=${principal}`,
      ],
    });
    const started = calls.some(
      (call) =>
        call.file === "databricks" &&
        call.args.slice(0, 3).join(" ") === "bundle run app",
    );
    assert.equal(
      started,
      failure === "",
      "failed setup must not start the app",
    );
    if (failure !== "seed")
      assert.deepEqual(
        calls.find((call) => call.args.includes("db:setup")),
        { file: "npm", args: ["run", "db:setup"], principal },
      );
    if (failure === "seed")
      await assert.rejects(readFile(join(directory, ".env")), {
        code: "ENOENT",
      });
    else
      assert.ok(
        (await readFile(join(directory, ".env"), "utf8"))
          .split("\n")
          .includes(`TRIP_SNAPSHOT_TABLE=${catalog}.${schema}.trips_2016`),
      );
  });
}
