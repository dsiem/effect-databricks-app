import { resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Analytics } from "./analytics.js";
import {
  Filters,
  GenieInput,
  GenieOperation,
  NoteInput,
  TripSearch,
} from "./domain.js";
import { InvalidRequest, type ServiceError } from "./errors.js";
import { Genie } from "./genie.js";
import { Notebook } from "./notebook.js";
import { Settings } from "./settings.js";

const badRequest = (cause?: unknown) =>
  new InvalidRequest({
    message: "Check the request fields, dates, and ZIP code.",
    cause,
  });
const httpError = (error: ServiceError) => {
  switch (error._tag) {
    case "InvalidRequest":
      return { status: 400, code: "invalid_request" };
    case "NoteNotFound":
      return { status: 404, code: "note_not_found" };
    case "ServiceUnavailable":
      return { status: 503, code: `${error.service}_unavailable` };
    case "UpstreamError":
      return { status: 502, code: `${error.service}_request_failed` };
    case "OperationTimeout":
      return { status: 504, code: `${error.service}_timeout` };
    case "GenieFailed":
      return { status: 409, code: "genie_message_unavailable" };
  }
};
const respond = <A, R>(effect: Effect.Effect<A, ServiceError, R>) =>
  effect.pipe(
    Effect.tapCause((cause) => Effect.logError("API operation failed", cause)),
    Effect.map((data) =>
      HttpServerResponse.jsonUnsafe(data, {
        headers: { "Cache-Control": "no-store" },
      }),
    ),
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { error: { code: httpError(error).code, message: error.message } },
          {
            status: httpError(error).status,
            headers: { "Cache-Control": "no-store" },
          },
        ),
      ),
    ),
  );
const readFilters = HttpRouter.schemaParams(Filters).pipe(
  Effect.mapError(badRequest),
  Effect.flatMap((filters) =>
    filters.from && filters.to && filters.from > filters.to
      ? Effect.fail(badRequest())
      : Effect.succeed(filters),
  ),
);

export const Routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const analytics = yield* Analytics;
    const genie = yield* Genie;
    const notebook = yield* Notebook;
    const settings = yield* Settings;
    yield* router.add(
      "GET",
      "/health",
      HttpServerResponse.jsonUnsafe({ status: "ok" }),
    );
    yield* router.add(
      "GET",
      "/api/status",
      HttpServerResponse.jsonUnsafe({
        dataset: "samples.nyctaxi.trips",
        warehouse: !!settings.warehouseId,
        genie: !!settings.genieSpaceId,
        lakebase: !!(settings.pgHost || settings.lakebaseEndpoint),
        auth: settings.clientId
          ? "App service principal"
          : "Local development identity",
      }),
    );
    yield* router.add("GET", "/api/metadata", respond(analytics.metadata));
    yield* router.add(
      "GET",
      "/api/overview",
      respond(Effect.flatMap(readFilters, analytics.overview)),
    );
    yield* router.add(
      "GET",
      "/api/trips",
      respond(
        Effect.gen(function* () {
          yield* readFilters;
          const search = yield* HttpRouter.schemaParams(TripSearch).pipe(
            Effect.mapError(badRequest),
          );
          return yield* analytics.trips(search);
        }),
      ),
    );
    yield* router.add(
      "POST",
      "/api/genie",
      respond(
        Effect.flatMap(
          HttpServerRequest.schemaBodyJson(GenieInput).pipe(
            Effect.mapError(badRequest),
          ),
          genie.submit,
        ),
      ),
    );
    yield* router.add(
      "GET",
      "/api/genie/:conversationId/messages/:messageId",
      respond(
        Effect.flatMap(
          HttpRouter.schemaParams(GenieOperation).pipe(
            Effect.mapError(badRequest),
          ),
          genie.poll,
        ),
      ),
    );
    yield* router.add(
      "GET",
      "/api/genie/:conversationId/messages/:messageId/result",
      respond(
        Effect.flatMap(
          HttpRouter.schemaParams(GenieOperation).pipe(
            Effect.mapError(badRequest),
          ),
          genie.result,
        ),
      ),
    );
    yield* router.add("GET", "/api/notes", respond(notebook.list));
    yield* router.add(
      "PUT",
      "/api/notes",
      respond(
        Effect.flatMap(
          HttpServerRequest.schemaBodyJson(NoteInput).pipe(
            Effect.mapError(badRequest),
          ),
          notebook.save,
        ),
      ),
    );
    yield* router.add(
      "DELETE",
      "/api/notes/:id",
      respond(
        Effect.gen(function* () {
          const { id } = yield* HttpRouter.schemaParams(
            Schema.Struct({ id: NoteInput.fields.id }),
          ).pipe(Effect.mapError(badRequest));
          yield* notebook.remove(id);
          return { deleted: true };
        }),
      ),
    );
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
