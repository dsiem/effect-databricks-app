import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { Status } from "../shared/domain.js";
import { Analytics } from "../src/analytics.js";
import { Genie } from "../src/genie.js";
import { Lakebase } from "../src/lakebase.js";
import { Routes } from "../src/routes.js";
import { SavedViews } from "../src/saved-views.js";
import { Settings } from "../src/settings.js";
import { TripComments } from "../src/trip-comments.js";
import { Workspace } from "../src/workspace.js";

const configuration = (env: Record<string, string>) =>
  Settings.layer.pipe(
    Layer.provide(
      Layer.succeed(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord(env),
      ),
    ),
  );

for (const { env, mode, label } of [
  {
    env: {
      DATABRICKS_TOKEN: "explicit-token",
      DATABRICKS_CLIENT_ID: "client",
      DATABRICKS_CLIENT_SECRET: "secret",
    },
    mode: "token",
    label: "Configured access token",
  },
  {
    env: { DATABRICKS_CLIENT_ID: "client", DATABRICKS_CLIENT_SECRET: "secret" },
    mode: "oauth",
    label: "App service principal",
  },
  {
    env: { DATABRICKS_CLIENT_ID: "client" },
    mode: "cli",
    label: "Local development identity",
  },
]) {
  test(`status reports the resolved ${mode} authentication without fetching credentials`, async () => {
    const settings = configuration({
      DATABRICKS_HOST: "https://workspace.example",
      ...env,
    });
    const workspace = Workspace.layer.pipe(Layer.provide(settings));
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Workspace;
        assert.equal(service.authMode, mode);
        if (service.authMode === "token")
          assert.equal(
            Redacted.value(yield* service.accessToken),
            "explicit-token",
          );
      }).pipe(Effect.provide(workspace)),
    );
    const app = statusApp({
      DATABRICKS_HOST: "https://workspace.example",
      ...env,
    });
    try {
      const response = await app.handler(
        new Request("http://localhost/api/status"),
      );
      assert.equal(response.status, 200);
      const status = Schema.decodeUnknownSync(Status)(await response.json());
      assert.equal(status.auth, label);
    } finally {
      await app.dispose();
    }
  });
}

function statusApp(env: Record<string, string>) {
  const services = Layer.mergeAll(
    Analytics.layer,
    Genie.layer,
    SavedViews.layer,
    TripComments.layer,
  ).pipe(
    Layer.provideMerge(Lakebase.layer),
    Layer.provideMerge(Workspace.layer),
    Layer.provideMerge(configuration(env)),
  );
  return HttpRouter.toWebHandler(
    Routes.pipe(
      Layer.provide(services),
      Layer.provideMerge(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
}

for (const { env, configured } of [
  { env: { GENIE_SPACE_ID: "space" }, configured: false },
  {
    env: {
      GENIE_SPACE_ID: "space",
      DATABRICKS_HOST: "https://workspace.example",
      DATABRICKS_WAREHOUSE_ID: "warehouse",
      TRIP_SNAPSHOT_TABLE: "catalog.schema.trips",
      PGHOST: "database.example",
    },
    configured: true,
  },
]) {
  test(`status derives configured=${configured} from the services' capability state`, async () => {
    const app = statusApp(env);
    try {
      const response = await app.handler(
        new Request("http://localhost/api/status"),
      );
      const status = Schema.decodeUnknownSync(Status)(await response.json());
      assert.equal(status.warehouse, configured);
      assert.equal(status.genie, configured);
      assert.equal(status.lakebase, configured);
      assert.deepEqual(status.capabilities, {
        warehouse: configured ? "unknown" : "unconfigured",
        genie: configured ? "unknown" : "unconfigured",
        lakebase: configured ? "unknown" : "unconfigured",
      });
    } finally {
      await app.dispose();
    }
  });
}
