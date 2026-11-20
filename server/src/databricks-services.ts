import { Effect, Layer } from "effect";
import { AnalysisRuns } from "./analysis-runs.js";
import { Analytics } from "./analytics.js";
import type { DatabricksCapability } from "./databricks-capabilities.js";
import { Genie } from "./genie.js";
import { Lakebase } from "./lakebase.js";
import { SavedViews } from "./saved-views.js";
import { Settings } from "./settings.js";
import { TripComments } from "./trip-comments.js";
import { bindWarehouseClient } from "./warehouse.js";
import { Workspace } from "./workspace.js";

// Planning invokes attach and returns the same lazy Layers that the app builds at startup.
export function workbenchServices(
  attach: (resource: DatabricksCapability) => Effect.Effect<void> = () =>
    Effect.void,
) {
  return Effect.gen(function* () {
    const warehouse = yield* bindWarehouseClient(attach);
    const jobs = yield* AnalysisRuns.forApp(attach);
    const genie = yield* Genie.forApp(attach);
    const lakebase = yield* Lakebase.forApp(attach);

    return Layer.mergeAll(
      jobs,
      genie,
      SavedViews.layer,
      TripComments.layer,
    ).pipe(
      Layer.provideMerge(Analytics.fromWarehouse),
      Layer.provideMerge(warehouse),
      Layer.provideMerge(lakebase),
      Layer.provideMerge(Workspace.layer),
      Layer.provideMerge(Settings.layer),
    );
  });
}
