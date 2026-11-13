import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:http2";
import { setTimeout as delay } from "node:timers/promises";

async function requestHttp2(origin, path) {
  const session = connect(origin);
  try {
    return await new Promise((resolve, reject) => {
      session.once("error", reject);
      const request = session.request({ ":path": path });
      let status;
      let body = "";
      request.setEncoding("utf8");
      request.setTimeout(3000, () =>
        request.destroy(new Error("Request timed out")),
      );
      request.once("response", (headers) => {
        status = headers[":status"];
      });
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.once("error", reject);
      request.once("end", () => resolve({ status, body }));
      request.end();
    });
  } finally {
    session.destroy();
  }
}

for (const protocol of ["http1", "http2"]) {
  const app = spawn(process.execPath, ["dist/main.js"], {
    env: {
      ...process.env,
      DATABRICKS_APP_PORT: "0",
      APP_HTTP_PROTOCOL: protocol,
      NO_COLOR: "1",
    },
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
      if (protocol === "http2") return requestHttp2(origin, path);
      const response = await fetch(`${origin}${path}`, {
        signal: AbortSignal.timeout(3000),
      });
      return { status: response.status, body: await response.text() };
    };

    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { status: "ok" });
    const root = await request("/");
    assert.equal(root.status, 200);
    assert.equal(JSON.parse(root.body).name, "databricks-effect-app");
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
    console.log(`${protocol}: root, health, 404, and graceful shutdown passed`);
  } finally {
    if (app.exitCode === null && app.signalCode === null) {
      app.kill("SIGKILL");
      await exited;
    }
  }
}
