import { Effect } from "effect";
import { filtersFromQuery } from "../../domain/filters";
import { ApiClient, request } from "../../lib/api-client";
import { jsonMap } from "./dataset";
import type { MapQuery } from "./dataset-session";

export async function loadGps(
  { query, endpoint }: MapQuery,
  signal: AbortSignal,
) {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const filters = filtersFromQuery(query);
      if (!filters) return yield* Effect.fail(new Error("Invalid map filters"));
      const search = { ...filters, endpoint };
      const response = yield* request((client) =>
        client.tripMap({ query: search }),
      );
      if (response.endpoint !== endpoint)
        return yield* Effect.fail(new Error("Invalid map endpoint"));
      return yield* Effect.try(() => jsonMap(response));
    }).pipe(Effect.provide(ApiClient.layer), Effect.scoped, Effect.result),
    { signal },
  );
  if (result._tag === "Failure") throw result.failure;
  return result.success;
}
