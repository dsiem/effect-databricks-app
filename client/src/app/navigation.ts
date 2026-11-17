import { Update } from "foldkit";
import { openAnalysisRuns } from "../features/analysis-runs/update";
import { reloadGps } from "../features/gps/update";
import { reloadOverview } from "../features/overview/update";
import { reloadTrips } from "../features/trips/update";
import type { ApiClient } from "../lib/api-client";
import { analysisRunsMessage, gpsMessage, type Message } from "./message";
import type { Model } from "./model";
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
    case "Trips": {
      const loaded = reloadTrips(model.tripsState, {
        filters,
        sort: route.sort,
      });
      return {
        model: { ...model, tripsState: loaded.model, genieState },
        commands: loaded.commands ?? [],
      };
    }
    case "Genie":
    case "NotFound":
      return { model };
  }
}
