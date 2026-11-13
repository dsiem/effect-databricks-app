import { resolve, sep } from "node:path";
import { Effect, Layer, type Types } from "effect";
import {
  HttpEffect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import { Analytics } from "./analytics.js";
import {
  ApiBoundary,
  type ApiError,
  AppApi,
  invalidRequestBody,
} from "./api.js";
import { makeCurrentUser } from "./current-user.js";
import type { Filters } from "./domain.js";
import { InvalidRequest, type ServiceError } from "./errors.js";
import { Genie } from "./genie.js";
import { Notebook } from "./notebook.js";
import { Settings } from "./settings.js";

const toApiError = (error: ServiceError): typeof ApiError.Type => {
  const message = error.message;
  switch (error._tag) {
    case "InvalidRequest":
      return { error: { code: "invalid_request", message } };
    case "NoteNotFound":
      return { error: { code: "note_not_found", message } };
    case "ServiceUnavailable":
      return { error: { code: `${error.service}_unavailable`, message } };
    case "UpstreamError":
      return { error: { code: `${error.service}_request_failed`, message } };
    case "OperationTimeout":
      return { error: { code: `${error.service}_timeout`, message } };
    case "GenieFailed":
      return { error: { code: "genie_message_unavailable", message } };
  }
};
const respond = <A, R>(effect: Effect.Effect<A, ServiceError, R>) =>
  effect.pipe(
    Effect.tapCause((cause) => Effect.logError("API operation failed", cause)),
    Effect.mapError(toApiError),
  );
const validateDates = (filters: Filters) =>
  filters.from && filters.to && filters.from > filters.to
    ? Effect.fail(
        new InvalidRequest({ message: invalidRequestBody().error.message }),
      )
    : Effect.void;

const BoundaryLive = Layer.succeed(ApiBoundary, (effect) =>
  Effect.gen(function* () {
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        HttpServerResponse.setHeader(response, "Cache-Control", "no-store"),
      ),
    );
    return yield* effect.pipe(
      Effect.catch(
        (
          error,
        ): Effect.Effect<never, Types.unhandled | typeof ApiError.Type> => {
          if (!HttpApiError.HttpApiSchemaError.is(error))
            return Effect.fail(error);
          // Invalid service output is a defect, never a client validation error.
          return ["Params", "Query", "Headers", "Payload"].includes(error.kind)
            ? Effect.fail(invalidRequestBody())
            : Effect.die(error);
        },
      ),
    );
  }),
);

const ApiLive = HttpApiBuilder.group(AppApi, "app", (handlers) =>
  Effect.gen(function* () {
    const analytics = yield* Analytics;
    const genie = yield* Genie;
    const notebook = yield* Notebook;
    const settings = yield* Settings;
    const currentUser = yield* makeCurrentUser;
    return handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("status", () =>
        Effect.succeed({
          dataset: "samples.nyctaxi.trips",
          warehouse: !!settings.warehouseId,
          genie: !!settings.genieSpaceId,
          lakebase: !!(settings.pgHost || settings.lakebaseEndpoint),
          auth: settings.clientId
            ? "App service principal"
            : "Local development identity",
        }),
      )
      .handle("currentUser", () =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
          currentUser(request.headers),
        ),
      )
      .handle("metadata", () => respond(analytics.metadata))
      .handle("overview", ({ query }) =>
        respond(
          validateDates(query).pipe(Effect.andThen(analytics.overview(query))),
        ),
      )
      .handle("trips", ({ query }) =>
        respond(
          validateDates(query).pipe(Effect.andThen(analytics.trips(query))),
        ),
      )
      .handle("submitGenie", ({ payload }) => respond(genie.submit(payload)))
      .handle("pollGenie", ({ params }) => respond(genie.poll(params)))
      .handle("genieResult", ({ params }) => respond(genie.result(params)))
      .handle("notes", () => respond(notebook.list))
      .handle("saveNote", ({ payload }) => respond(notebook.save(payload)))
      .handle("removeNote", ({ params }) =>
        respond(
          notebook
            .remove(params.id)
            .pipe(Effect.as({ deleted: true as const })),
        ),
      );
  }),
).pipe(Layer.provide(BoundaryLive));

const StaticRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const webRoot = resolve("client/dist");
    const serveFile = (path: string) =>
      HttpServerResponse.file(path).pipe(
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        ),
      );
    yield* router.add(
      "GET",
      "/assets/*",
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        const path = resolve(
          webRoot,
          `.${new URL(request.url, "http://localhost").pathname}`,
        );
        return path.startsWith(`${webRoot}${sep}assets${sep}`)
          ? serveFile(path)
          : Effect.succeed(HttpServerResponse.empty({ status: 404 }));
      }),
    );
    yield* router.add(
      "GET",
      "/nyc-zips.geojson",
      serveFile(resolve(webRoot, "nyc-zips.geojson")),
    );
    for (const path of [
      "/",
      "/trips",
      "/map",
      "/genie",
      "/notebook",
    ] as const) {
      yield* router.add("GET", path, serveFile(resolve(webRoot, "index.html")));
    }
  }),
);

export const Routes = Layer.merge(
  HttpApiBuilder.layer(AppApi).pipe(Layer.provide(ApiLive)),
  StaticRoutes,
);
