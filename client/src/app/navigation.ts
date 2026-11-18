import { Update } from "foldkit";
import type { TripSort } from "../../../shared/domain";
import { href, withTripSort } from "../domain/filters";
import { openAnalysisRuns } from "../features/analysis-runs/update";
import { reloadGps } from "../features/gps/update";
import { reloadOverview } from "../features/overview/update";
import { reloadTrips } from "../features/trips/update";
import type { ApiClient } from "../lib/api-client";
import { Navigate } from "./commands";
import {
  analysisRunsMessage,
  gpsMessage,
  type Message,
  tripsMessage,
} from "./message";
import type { Model } from "./model";
import { AppRoute, paths } from "./route";

export function loadPage(
  model: Model,
): Update.Return<Model, Message, ApiClient> {
  const { route, query, filters } = model.location;
  if (route._tag === "AnalysisRuns") {
    return Update.foldChildInit(
      openAnalysisRuns(model.analysisRunsState, route.run),
      {
        toParentModel: (analysisRunsState) => ({ ...model, analysisRunsState }),
        toParentMessage: analysisRunsMessage,
      },
    );
  }
  if (!filters) return { model };
  const genieState = { ...model.genieState, genieSelection: null };
  switch (route._tag) {
    case "TripMap":
      return Update.foldChildInit(
        reloadGps(model.gpsState, { query, filters }),
        {
          toParentModel: (gpsState) => ({ ...model, gpsState, genieState }),
          toParentMessage: gpsMessage,
        },
      );
    case "Overview": {
      const loaded = reloadOverview(model.overviewState, filters);
      return {
        model: { ...model, overviewState: loaded.model, genieState },
        commands: loaded.commands ?? [],
      };
    }
    case "Trips":
      return Update.foldChildInit(
        reloadTrips(model.tripsState, { filters, sort: route.sort }),
        {
          toParentModel: (tripsState) => ({ ...model, tripsState, genieState }),
          toParentMessage: tripsMessage,
        },
      );
    case "Genie":
    case "NotFound":
      return { model };
  }
}

export function sortTrips(
  model: Model,
  sort: typeof TripSort.Type,
): Update.Return<Model, Message, ApiClient> {
  const query = withTripSort(model.location.query, sort);
  const loaded = loadPage({
    ...model,
    location: { ...model.location, route: AppRoute.Trips({ sort }), query },
  });
  return {
    ...loaded,
    commands: [
      ...(loaded.commands ?? []),
      Navigate({ href: href(paths.Trips, query), external: false }),
    ],
  };
}
