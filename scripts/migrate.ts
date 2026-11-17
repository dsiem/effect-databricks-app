import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import { makeLakebaseClient } from "../server/src/lakebase.js";
import { migrateAppSchema } from "../server/src/migrations.js";
import { restoreCredentialFailure } from "../server/src/pg-credentials.js";
import { Settings } from "../server/src/settings.js";
import { Workspace } from "../server/src/workspace.js";

NodeRuntime.runMain(
  Effect.gen(function* () {
    const sql = yield* makeLakebaseClient;
    yield* migrateAppSchema(sql, process.env.APP_SERVICE_PRINCIPAL_ID);
    yield* Effect.log("Lakebase application schema is ready");
  }).pipe(
    restoreCredentialFailure,
    Effect.provide(Reactivity.layer),
    Effect.scoped,
    Effect.provide(Workspace.layer.pipe(Layer.provideMerge(Settings.layer))),
  ),
);
