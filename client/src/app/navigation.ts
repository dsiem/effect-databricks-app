import type { Update } from "foldkit";
import { filtersFromQuery } from "../domain/filters";
import { reloadGps } from "../features/gps/update";
import * as OverviewCommands from "../features/overview/commands";
import * as TripsCommands from "../features/trips/commands";
import { RefreshTripGrid } from "../features/trips/grid-mount";
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
  if (model.path === "/trips-preview") {
    const revision = model.tripsState.gridRevision + 1;
    const key = `${requestKey(model)}:${revision}`;
    return {
      model: {
        ...model,
        genieState: { ...model.genieState, genieSelection: null },
        tripsState: {
          ...model.tripsState,
          gridWindow: null,
          gridKey: key,
          gridRevision: revision,
          gridStatus: {
            ...model.tripsState.gridStatus,
            key,
            scope: "none",
            total: 0,
            loaded: 0,
            loading: true,
            error: "",
          },
        },
      },
      commands: [
        RefreshTripGrid({
          key,
          query: { filters, sort: model.tripsState.sort },
          countsVersion: model.tripsState.commentCountsVersion,
          selectedId: model.tripsState.selectedTrip?.trip_id ?? null,
        }),
      ],
    };
  }
  return { model };
}
