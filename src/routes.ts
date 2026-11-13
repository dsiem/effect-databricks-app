import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

export const Routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add(
      "GET",
      "/",
      HttpServerResponse.json({
        name: "databricks-effect-app",
        health: "/health",
      }),
    );
    yield* router.add(
      "GET",
      "/health",
      HttpServerResponse.json({ status: "ok" }),
    );
  }),
);
