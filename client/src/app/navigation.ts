import type { Update } from "foldkit";
import { filtersFromQuery } from "../domain/filters";
import { reloadGps } from "../features/gps/update";
import * as OverviewCommands from "../features/overview/commands";
import { reloadTrips } from "../features/trips/update";
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
  if (model.path === "/trips" || model.path === "/trips-preview") {
    const loaded = reloadTrips(model.tripsState, {
      requestKey: requestKey(model),
      filters,
      preview: model.path === "/trips-preview",
    });
    return {
      model: {
        ...model,
        tripsState: loaded.model,
        genieState: { ...model.genieState, genieSelection: null },
      },
      commands: loaded.commands ?? [],
    };
  }
  return { model };
}
