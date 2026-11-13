import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect } from "effect";
import { ServerConfig } from "../src/config.js";

const readConfig = (env: Record<string, string>) =>
  Effect.runPromise(ServerConfig.parse(ConfigProvider.fromEnvRecord(env)));

test("starts locally without Databricks credentials", async () => {
  assert.deepEqual(await readConfig({}), { port: 3000, protocol: "http1" });
});

test("reads the Databricks port and HTTP/2 setting", async () => {
  assert.deepEqual(
    await readConfig({
      DATABRICKS_APP_PORT: "8000",
      APP_HTTP_PROTOCOL: "http2",
    }),
    { port: 8000, protocol: "http2" },
  );
});

test("accepts an ephemeral port for smoke checks", async () => {
  assert.equal((await readConfig({ DATABRICKS_APP_PORT: "0" })).port, 0);
});

test("treats empty environment values as absent", async () => {
  assert.deepEqual(
    await readConfig({ DATABRICKS_APP_PORT: "", APP_HTTP_PROTOCOL: "" }),
    { port: 3000, protocol: "http1" },
  );
});

for (const port of ["-1", "65536", "1.5", "invalid"]) {
  test(`rejects invalid port ${JSON.stringify(port)} without falling back`, async () => {
    await assert.rejects(readConfig({ DATABRICKS_APP_PORT: port }));
  });
}

test("rejects unsupported protocols", async () => {
  await assert.rejects(readConfig({ APP_HTTP_PROTOCOL: "https" }));
});
