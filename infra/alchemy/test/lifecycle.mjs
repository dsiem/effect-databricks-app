import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const prototype = resolve(import.meta.dirname, "..");
const sqlFile = "jobs/route-reliability.sql";

test("plan, deploy, update, and destroy the app stack through the Databricks CLI", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "alchemy-databricks-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const cwd = join(temp, "infra/alchemy");
  await cp(prototype, cwd, {
    recursive: true,
    filter: (path) =>
      !["node_modules", ".alchemy", "test", ".env"].includes(basename(path)),
  });
  await symlink(
    join(prototype, "node_modules"),
    join(cwd, "node_modules"),
    "dir",
  );
  for (const directory of ["server", "shared"]) {
    await symlink(
      resolve(prototype, "../..", directory),
      join(temp, directory),
      "dir",
    );
  }
  await mkdir(join(temp, "jobs"));
  await cp(
    resolve(prototype, "../../tsconfig.json"),
    join(temp, "tsconfig.json"),
  );
  await cp(resolve(prototype, "../..", sqlFile), join(temp, sqlFile));

  const files = new Map();
  const jobs = new Map();
  let app;
  let release;
  const writes = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/.well-known/databricks-config") {
      res.writeHead(404).end();
      return;
    }
    const endpoint = url.pathname.replace(/^\/api\/2\.\d+\//, "");
    const operation = `${req.method} ${endpoint.replace(/^apps\/[^/]+/, "apps/:name")}`;
    try {
      assert.equal(req.headers.authorization, "Bearer test-pat");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      let result = {};
      const canonical = (path) => path.replace(/^\/Workspace\//, "/");
      switch (operation) {
        case "GET workspace/list":
          result = {
            objects: [...files.keys()].map((path) => ({
              path,
              object_id: 42,
              object_type: "FILE",
            })),
          };
          break;
        case "POST workspace/import": {
          const path = canonical(body.path);
          assert.equal(body.format, "RAW");
          assert.ok(body.overwrite || !files.has(path));
          files.set(path, Buffer.from(body.content, "base64").toString());
          break;
        }
        case "POST workspace/delete":
          assert.ok(files.delete(canonical(body.path)));
          break;
        case "GET jobs/list":
          result = {
            jobs: [...jobs]
              .filter(
                ([, settings]) =>
                  !url.searchParams.has("name") ||
                  settings.name === url.searchParams.get("name"),
              )
              .map(([job_id, settings]) => ({ job_id, settings })),
          };
          break;
        case "POST jobs/create":
          assert.equal(jobs.size, 0);
          assert.ok(files.has(canonical(body.tasks[0].sql_task.file.path)));
          jobs.set(123, body);
          result = { job_id: 123 };
          break;
        case "POST jobs/reset":
          assert.ok(jobs.has(body.job_id));
          jobs.set(body.job_id, body.new_settings);
          break;
        case "POST jobs/delete":
          assert.ok(jobs.delete(body.job_id));
          break;
        case "GET apps":
          result = { apps: app ? [app] : [] };
          break;
        case "POST apps":
          assert.equal(app, undefined);
          assert.equal(url.searchParams.get("no_compute"), "true");
          app = { ...body, id: "test-id", url: "https://test-app.invalid" };
          result = app;
          break;
        case "PATCH apps/:name":
          assert.equal(endpoint, `apps/${app.name}`);
          app = { ...body, name: app.name, id: app.id, url: app.url };
          result = app;
          break;
        case "DELETE apps/:name":
          assert.equal(endpoint, `apps/${app.name}`);
          app = undefined;
          break;
        case "POST apps/:name/deployments":
          assert.equal(endpoint, `apps/${app.name}/deployments`);
          release = body;
          result = { deployment_id: "test-release" };
          break;
        default:
          throw new Error(`Unexpected ${req.method} ${url.pathname}`);
      }
      if (req.method !== "GET") writes.push(operation);
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
    } catch (error) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({ error_code: "BAD_REQUEST", message: error.message }),
        );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((done) => server.close(done)));

  const env = {
    PATH: process.env.PATH,
    HOME: temp,
    ALCHEMY_HOME: join(temp, ".alchemy"),
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
    CI: "true",
    DATABRICKS_HOST: `http://127.0.0.1:${server.address().port}`,
    DATABRICKS_AUTH_TYPE: "pat",
    DATABRICKS_TOKEN: "test-pat",
    DATABRICKS_WORKSPACE_DIR: "/Workspace/Users/test",
    DATABRICKS_WAREHOUSE_ID: "abc123",
    DATABRICKS_GENIE_SPACE_ID: "1234567890abcdef1234567890abcdef",
    DATABRICKS_GENIE_SPACE_NAME: "Test Genie",
    DATABRICKS_POSTGRES_BRANCH: "projects/test/branches/production",
    DATA_CATALOG: "workspace",
    DATA_SCHEMA: "smoke-schema",
  };
  const alchemy = (...args) =>
    run(join(cwd, "node_modules/.bin/alchemy"), args, {
      cwd,
      env,
      timeout: 60_000,
    }).catch((error) => {
      throw new Error(
        `alchemy ${args.join(" ")} failed\n${error.stdout}\n${error.stderr}`,
        { cause: error },
      );
    });

  const deploy = () => alchemy("deploy", "--stage", "smoke", "--yes");
  await alchemy("plan", "--stage", "smoke");
  assert.deepEqual(writes, []);
  await deploy();
  assert.deepEqual(writes, [
    "POST workspace/import",
    "POST jobs/create",
    "POST apps",
  ]);
  const bindings = app.resources;
  assert.equal(bindings.length, 4);
  const state = await alchemy(
    "state",
    "read",
    "--backend",
    "local",
    "TaxiWorkbench/smoke/output",
  );
  const output = JSON.parse(state.stdout);
  assert.equal(output.appName, app.name);
  assert.equal(output.jobId, 123);
  for (const [kind, [variable, permission]] of Object.entries({
    job: ["ANALYSIS_JOB_ID", "CAN_MANAGE_RUN"],
    sql_warehouse: ["DATABRICKS_WAREHOUSE_ID", "CAN_USE"],
    genie_space: ["GENIE_SPACE_ID", "CAN_RUN"],
    postgres: ["LAKEBASE_ENDPOINT", "CAN_CONNECT_AND_CREATE"],
  })) {
    const binding = bindings.find((binding) => binding[kind]);
    assert.ok(binding);
    assert.equal(binding[kind].permission, permission);
    assert.equal(
      output.deploymentConfig.env_vars.find((entry) => entry.name === variable)
        ?.value_from,
      binding.name,
    );
  }
  assert.equal(bindings.find((binding) => binding.job).job.id, "123");
  const releaseBody = {
    ...output.deploymentConfig,
    source_code_path: "/Workspace/Users/test/app",
  };
  await run(
    "databricks",
    [
      "apps",
      "deploy",
      app.name,
      "--json",
      JSON.stringify(releaseBody),
      "--no-wait",
    ],
    { cwd, env },
  );
  assert.deepEqual(release, releaseBody);
  const runtimeEnv = Object.fromEntries(
    release.env_vars.map(({ name, value, value_from }) => {
      if (value !== undefined) return [name, value];
      const binding = bindings.find((item) => item.name === value_from);
      assert.ok(binding, `Missing runtime attachment: ${value_from}`);
      const resolved =
        binding.sql_warehouse?.id ??
        binding.job?.id ??
        binding.genie_space?.space_id ??
        `${binding.postgres.branch}/endpoints/primary`;
      return [name, resolved];
    }),
  );
  await run(
    process.execPath,
    ["--import", "tsx", "server/test/alchemy-runtime.ts"],
    {
      cwd: resolve(prototype, "../.."),
      env: {
        PATH: process.env.PATH,
        ...runtimeEnv,
        DATABRICKS_HOST: "https://workspace.invalid",
        DATABRICKS_APP_NAME: app.name,
        DATABRICKS_TOKEN: "runtime-pat",
      },
      timeout: 15_000,
    },
  );
  assert.deepEqual(
    [...files.values()],
    [await readFile(join(temp, sqlFile), "utf8")],
  );
  assert.equal(
    jobs.get(123).tasks[0].sql_task.warehouse_id,
    env.DATABRICKS_WAREHOUSE_ID,
  );
  writes.length = 0;
  await deploy();
  assert.deepEqual(writes, []);
  env.DATA_SCHEMA = "changed-schema";
  env.DATABRICKS_WAREHOUSE_ID = "def456";
  await deploy();
  assert.deepEqual(writes, ["POST jobs/reset", "PATCH apps/:name"]);
  assert.deepEqual(
    app.resources.filter((binding) => !binding.sql_warehouse),
    bindings.filter((binding) => !binding.sql_warehouse),
  );
  assert.equal(
    app.resources.find((binding) => binding.sql_warehouse).sql_warehouse.id,
    env.DATABRICKS_WAREHOUSE_ID,
  );
  assert.equal(
    jobs.get(123).tasks[0].sql_task.parameters.snapshot_table,
    "`workspace`.`changed-schema`.`trips`",
  );
  const [path] = files.keys();
  const changedSql = files.get(path) + "\n-- revised SQL file\n";
  await writeFile(join(temp, sqlFile), changedSql);
  writes.length = 0;
  await deploy();
  assert.deepEqual(writes, ["POST workspace/import"]);
  assert.deepEqual([...files], [[path, changedSql]]);
  writes.length = 0;
  await alchemy("destroy", "--stage", "smoke", "--yes");
  assert.deepEqual(writes, [
    "DELETE apps/:name",
    "POST jobs/delete",
    "POST workspace/delete",
  ]);
  assert.equal(app, undefined);
  assert.equal(jobs.size, 0);
  assert.equal(files.size, 0);
});
