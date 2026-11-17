import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { Analytics } from "./analytics.js";
import { ServerConfig } from "./config.js";
import { Genie } from "./genie.js";
import { Lakebase } from "./lakebase.js";
import { Routes } from "./routes.js";
import { SavedViews } from "./saved-views.js";
import { Settings } from "./settings.js";
import { TripComments } from "./trip-comments.js";
import { Workspace } from "./workspace.js";

const ServerLive = Layer.unwrap(
  Effect.map(ServerConfig, ({ port }) =>
    NodeHttpServer.layer(createServer, {
      host: "0.0.0.0",
      port,
      gracefulShutdownTimeout: "5 seconds",
    }),
  ),
);

const Services = Layer.mergeAll(
  Analytics.layer,
  Genie.layer,
  SavedViews.layer,
  TripComments.layer,
).pipe(
  Layer.provideMerge(Lakebase.layer),
  Layer.provideMerge(Workspace.layer),
  Layer.provideMerge(Settings.layer),
);
const AppLive = HttpRouter.serve(Routes.pipe(Layer.provide(Services))).pipe(
  Layer.provide(ServerLive),
);

NodeRuntime.runMain(Layer.launch(AppLive));
