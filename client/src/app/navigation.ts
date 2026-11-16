import type { Update } from "foldkit";
import { filtersFromQuery } from "../domain/filters";
import { reloadGps } from "../features/gps/update";
import * as OverviewCommands from "../features/overview/commands";
import * as TripsCommands from "../features/trips/commands";
import type { ApiClient } from "../lib/api-client";
import { pending } from "../lib/request-state";
import type { Message } from "./message";
import { type Model, requestKey } from "./model";
export function loadPage(
  model: Model,
): Update.Return<Model, Message, ApiClient> {
  const filters = filtersFromQuery(model.query);
  if (!filters) return { model };
  if (model.path === "/trip-map") {
    const loaded = reloadGps(model.gpsState, model.query);
    return {
      model: {
        ...model,
        gpsState: loaded.model,
        genieState: { ...model.genieState, genieSelection: null },
      },
      commands: loaded.commands ?? [],
    };
  }
  if (model.path === "/")
    return {
      model: {
        ...model,
        overviewState: { ...model.overviewState, overview: pending },
        genieState: { ...model.genieState, genieSelection: null },
      },
      commands: [
        OverviewCommands.LoadOverview({ key: requestKey(model), filters }),
      ],
    };
  if (model.path === "/trips")
    return {
      model: {
        ...model,
        tripsState: { ...model.tripsState, trips: pending },
        genieState: { ...model.genieState, genieSelection: null },
      },
      commands: [
        TripsCommands.LoadTrips({
          key: requestKey(model),
          filters,
          page: model.tripsState.page,
          sort: model.tripsState.sort,
        }),
      ],
    };
  return { model };
}
