import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { ServerConfig } from "./config.js";
import { workbenchServices } from "./databricks-services.js";
import { Routes } from "./routes.js";

const ServerLive = Layer.unwrap(
  Effect.map(ServerConfig, ({ port }) =>
    NodeHttpServer.layer(createServer, {
      host: "0.0.0.0",
      port,
      gracefulShutdownTimeout: "5 seconds",
    }),
  ),
);

const Services = Layer.unwrap(workbenchServices());
const AppLive = HttpRouter.serve(Routes.pipe(Layer.provide(Services))).pipe(
  Layer.provide(ServerLive),
);

NodeRuntime.runMain(Layer.launch(AppLive));
