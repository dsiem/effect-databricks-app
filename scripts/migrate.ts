import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { migrate } from "../src/notebook.js";
import { Settings } from "../src/settings.js";
import { Workspace } from "../src/workspace.js";

NodeRuntime.runMain(
  migrate.pipe(
    Effect.tap(() => Effect.log("Lakebase notebook schema is ready")),
    Effect.scoped,
    Effect.provide(Workspace.layer.pipe(Layer.provideMerge(Settings.layer))),
  ),
);
