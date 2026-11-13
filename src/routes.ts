import { resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Analytics } from "./analytics.js";
import {
  AppError,
  Filters,
  GenieInput,
  NoteInput,
  TripSearch,
} from "./domain.js";
import { Genie } from "./genie.js";
import { Notebook } from "./notebook.js";
import { Settings } from "./settings.js";

const badRequest = new AppError({
  status: 400,
  code: "invalid_request",
  message: "Check the request fields, dates, and ZIP code.",
});
const respond = <A, R>(effect: Effect.Effect<A, AppError, R>) =>
  effect.pipe(
    Effect.map((data) =>
      HttpServerResponse.jsonUnsafe(data, {
        headers: { "Cache-Control": "no-store" },
      }),
    ),
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        ),
      ),
    ),
  );
const readFilters = HttpRouter.schemaParams(Filters).pipe(
  Effect.mapError(() => badRequest),
  Effect.flatMap((filters) =>
    filters.from && filters.to && filters.from > filters.to
      ? Effect.fail(badRequest)
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
            Effect.mapError(() => badRequest),
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
            Effect.mapError(() => badRequest),
          ),
          genie.ask,
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
            Effect.mapError(() => badRequest),
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
          ).pipe(Effect.mapError(() => badRequest));
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
