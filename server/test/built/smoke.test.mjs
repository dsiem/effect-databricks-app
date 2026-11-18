import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const entryPoint = ["dist/server/src/main.js"];
const env = {
  ...process.env,
  DATABRICKS_APP_PORT: "0",
  NO_COLOR: "1",
  DATABRICKS_HOST: "https://127.0.0.1:1",
  DATABRICKS_TOKEN: "fixture-token",
  DATABRICKS_WAREHOUSE_ID: "",
  GENIE_SPACE_ID: "fixture-space",
  PGHOST: "",
  LAKEBASE_ENDPOINT: "projects/offline/branches/main/endpoints/primary",
};
for (const [key, value] of [
  ["DATABRICKS_HOST", ""],
  ["GENIE_SPACE_ID", ""],
  ["GENIE_SPACE_ID", "   "],
]) {
  const failed = spawnSync(process.execPath, entryPoint, {
    env: { ...env, [key]: value },
    encoding: "utf8",
    timeout: 10000,
  });
  const output = failed.stdout + failed.stderr;
  assert.match(output, /Genie is required.*DATABRICKS_HOST.*GENIE_SPACE_ID/);
  assert.ifError(failed.error);
  assert.equal(failed.status, 1, output);
}

const app = spawn(process.execPath, entryPoint, {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(app, "exit");
let output = "";
for (const stream of [app.stdout, app.stderr]) {
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-8192);
  });
}

try {
  const deadline = Date.now() + 10000;
  let address = output.match(/http:\/\/0\.0\.0\.0:(\d+)/);
  while (!address) {
    assert.equal(app.exitCode, null, `App exited during startup:\n${output}`);
    assert.ok(Date.now() < deadline, `App startup timed out:\n${output}`);
    await delay(50);
    address = output.match(/http:\/\/0\.0\.0\.0:(\d+)/);
  }
  const origin = `http://127.0.0.1:${address[1]}`;
  const request = async (path) => {
    const response = await fetch(`${origin}${path}`, {
      signal: AbortSignal.timeout(3000),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  };

  const root = await request("/");
  assert.equal(root.status, 200);
  assert.match(root.body, /<div id="root"><\/div>/);
  const assets = [...root.body.matchAll(/src="([^"]+\.js)"/g)];
  assert.ok(assets.length > 0, "Built HTML references executable assets");
  for (const [, asset] of assets) {
    const response = await request(asset);
    assert.equal(response.status, 200, `${asset} is served`);
    assert.match(response.contentType ?? "", /javascript/);
    assert.ok(response.body.length > 0, `${asset} contains executable code`);
  }
  for (const path of ["/trips", "/trip-map", "/genie"]) {
    assert.equal((await request(path)).status, 200);
  }
  const savedViews = await request("/api/saved-views");
  assert.equal(savedViews.status, 503);
  assert.equal(JSON.parse(savedViews.body).error.code, "lakebase_unavailable");
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/api/metadata")).status, 503);
  assert.equal((await request("/missing")).status, 404);

  app.kill("SIGTERM");
  const [code, signal] = await Promise.race([
    exited,
    delay(10000, null, { ref: false }).then(() => {
      throw new Error(`Graceful shutdown timed out:\n${output}`);
    }),
  ]);
  assert.equal(signal, null, "App should handle SIGTERM");
  // Effect's default teardown reports a handled external interruption as 130.
  assert.equal(code, 130, `App shutdown failed:\n${output}`);
  console.log("Root, dependency failure, 404, and graceful shutdown passed");
} finally {
  if (app.exitCode === null && app.signalCode === null) {
    app.kill("SIGKILL");
    await exited;
  }
}
