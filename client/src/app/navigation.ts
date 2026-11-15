import type { Update } from "foldkit";
import { filtersFromQuery } from "../domain/filters";
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
  if (model.path === "/" || model.path === "/map")
    return {
      model: {
        ...model,
        overviewState: { ...model.overviewState, overview: pending },
        mapState: { ...model.mapState, mappedTrips: null, mapError: "" },
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
