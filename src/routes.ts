import { resolve, sep } from "node:path";
import { Effect, Layer, type Types } from "effect";
import {
  HttpEffect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import {
  ApiBoundary,
  type ApiError,
  AppApi,
  invalidRequestBody,
} from "../shared/api.js";
import { Analytics } from "./analytics.js";
import { makeCurrentUser } from "./current-user.js";
import type { ServiceError } from "./errors.js";
import { Genie } from "./genie.js";
import { Lakebase } from "./lakebase.js";
import { SavedViews } from "./saved-views.js";
import { Settings } from "./settings.js";
import { TripComments } from "./trip-comments.js";

const toApiError = (error: ServiceError): typeof ApiError.Type => {
  const message = error.message;
  switch (error._tag) {
    case "InvalidRequest":
      return { error: { code: "invalid_request", message } };
    case "NoteConflict":
      return { error: { code: "note_conflict", message } };
    case "NoteNotFound":
      return { error: { code: "note_not_found", message } };
    case "ServiceUnavailable":
      return { error: { code: `${error.service}_unavailable`, message } };
    case "UpstreamError":
      return {
        error: {
          code: `${error.service}_request_failed`,
          message,
          ...(error.upstreamStatus === undefined
            ? {}
            : { upstreamStatus: error.upstreamStatus }),
        },
      };
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
    const savedViews = yield* SavedViews;
    const comments = yield* TripComments;
    const lakebase = yield* Lakebase;
    const settings = yield* Settings;
    const currentUser = yield* makeCurrentUser;
    return handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("status", () =>
        Effect.all({
          warehouse: analytics.availability,
          genie: genie.availability,
          lakebase: lakebase.availability,
        }).pipe(
          Effect.map((capabilities) => ({
            dataset: settings.tripSnapshotTable || "samples.nyctaxi.trips",
            warehouse: !!(
              settings.warehouseId &&
              settings.host &&
              settings.tripSnapshotTable
            ),
            genie: !!settings.genieSpaceId,
            lakebase: !!(settings.pgHost || settings.lakebaseEndpoint),
            capabilities,
            auth: settings.clientId
              ? "App service principal"
              : "Local development identity",
          })),
        ),
      )
      .handle("currentUser", () =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
          currentUser(request.headers),
        ),
      )
      .handle("metadata", () => respond(analytics.metadata))
      .handle("overview", ({ query }) => respond(analytics.overview(query)))
      .handle("trips", ({ query }) => respond(analytics.trips(query)))
      .handle("submitGenie", ({ payload }) => respond(genie.submit(payload)))
      .handle("pollGenie", ({ params }) => respond(genie.poll(params)))
      .handle("genieResult", ({ params }) => respond(genie.result(params)))
      .handle("notes", ({ query }) => respond(savedViews.list(query)))
      .handle("tripComments", ({ query }) => respond(comments.list(query)))
      .handle("addTripComment", ({ payload }) =>
        respond(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const author = yield* currentUser(request.headers);
            return yield* comments.add(payload, author);
          }),
        ),
      )
      .handle("saveNote", ({ payload }) => respond(savedViews.save(payload)))
      .handle("pinNote", ({ params, payload }) =>
        respond(savedViews.pin(params.id, payload)),
      )
      .handle("removeNote", ({ params, query }) =>
        respond(
          savedViews
            .remove(params.id, query.version)
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
    yield* router.add(
      "GET",
      "/theme-init.js",
      serveFile(resolve(webRoot, "theme-init.js")),
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
