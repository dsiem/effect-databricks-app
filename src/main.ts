import { createServer as createHttpServer } from "node:http";
import { createServer as createHttp2Server } from "node:http2";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { Analytics } from "./analytics.js";
import { ServerConfig } from "./config.js";
import { Genie } from "./genie.js";
import { Notebook } from "./notebook.js";
import { Routes } from "./routes.js";
import { Settings } from "./settings.js";
import { Workspace } from "./workspace.js";

const ServerLive = Layer.unwrap(
  Effect.map(ServerConfig, ({ port, protocol }) =>
    NodeHttpServer.layer(
      () => (protocol === "http2" ? createHttp2Server() : createHttpServer()),
      { host: "0.0.0.0", port, gracefulShutdownTimeout: "5 seconds" },
    ),
  ),
);

const Services = Layer.mergeAll(
  Analytics.layer,
  Genie.layer,
  Notebook.layer,
).pipe(Layer.provideMerge(Workspace.layer), Layer.provideMerge(Settings.layer));
const AppLive = HttpRouter.serve(Routes.pipe(Layer.provide(Services))).pipe(
  Layer.provide(ServerLive),
);

NodeRuntime.runMain(Layer.launch(AppLive));
