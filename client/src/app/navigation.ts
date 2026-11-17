import type { Update } from "foldkit";
import { openAnalysisRuns } from "../features/analysis-runs/update";
import { reloadGps } from "../features/gps/update";
import * as OverviewCommands from "../features/overview/commands";
import { reloadTrips } from "../features/trips/update";
import type { ApiClient } from "../lib/api-client";
import { pending } from "../lib/request-state";
import type { Message } from "./message";
import { type Model, overviewRequestKey } from "./model";
export function loadPage(
  model: Model,
): Update.Return<Model, Message, ApiClient> {
  const { route, query, filters } = model.location;
  if (route._tag === "AnalysisRuns") {
    const opened = openAnalysisRuns(model.analysisRunsState, route.run);
    return {
      model: { ...model, analysisRunsState: opened.model },
      commands: opened.commands ?? [],
    };
  }
  if (!filters) return { model };
  const genieState = { ...model.genieState, genieSelection: null };
  switch (route._tag) {
    case "TripMap": {
      const loaded = reloadGps(model.gpsState, { query, filters });
      return {
        model: { ...model, gpsState: loaded.model, genieState },
        commands: loaded.commands ?? [],
      };
    }
    case "Overview":
      return {
        model: {
          ...model,
          overviewState: { ...model.overviewState, overview: pending },
          genieState,
        },
        commands: [
          OverviewCommands.LoadOverview({
            key: overviewRequestKey(model),
            filters,
          }),
        ],
      };
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
