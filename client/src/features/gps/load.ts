import { Effect } from "effect";
import type { GpsEndpoint } from "../../../../shared/domain";
import { filtersFromQuery } from "../../domain/filters";
import { ApiClient, request } from "../../lib/api-client";
import { jsonMap } from "./dataset";

export function loadGps(query: string, endpoint: GpsEndpoint) {
  return Effect.gen(function* () {
    const filters = filtersFromQuery(query);
    if (!filters) return yield* Effect.fail(new Error("Invalid map filters"));
    const search = { ...filters, endpoint };
    const response = yield* request((client) =>
      client.tripMap({ query: search }),
    );
    if (response.endpoint !== endpoint)
      return yield* Effect.fail(new Error("Invalid map endpoint"));
    return yield* Effect.try(() => jsonMap(response));
  }).pipe(Effect.provide(ApiClient.layer), Effect.scoped);
}
