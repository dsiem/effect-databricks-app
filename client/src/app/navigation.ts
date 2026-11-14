import type { Update } from "foldkit";
import * as OverviewCommands from "../features/overview/commands";
import * as TripsCommands from "../features/trips/commands";
import type { ApiClient } from "../lib/api-client";
import * as AppCommands from "./commands";
import type { Message } from "./message";
import { filtersFromQuery, href, type Model, requestKey } from "./model";
import { pending } from "./request-state";
export function loadPage(
  model: Model,
): Update.Return<Model, Message, ApiClient> {
  const filters = filtersFromQuery(model.query);
  if (!filters) return { model };
  if (model.path === "/" || model.path === "/map")
    return {
      model: {
        ...model,
        overview: pending,
        mappedTrips: null,
        mapError: "",
        genieSelection: null,
      },
      commands: [
        OverviewCommands.LoadOverview({ key: requestKey(model), filters }),
      ],
    };
  if (model.path === "/trips")
    return {
      model: { ...model, trips: pending, genieSelection: null },
      commands: [
        TripsCommands.LoadTrips({
          key: requestKey(model),
          filters,
          page: model.page,
          sort: model.sort,
        }),
      ],
    };
  return { model };
}
export const navigate = (model: Model, path: string, query: string) => ({
  model,
  commands: [
    AppCommands.Navigate({ href: href(path, query), external: false }),
  ],
});
