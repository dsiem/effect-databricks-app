import type { GenieContext } from "../../../shared/domain";
import { filtersFromQuery } from "../domain/filters";
import { gpsContext } from "../features/gps/context";
import { overviewContext } from "../features/overview/context";
import { gridContext, tripsContext } from "../features/trips/context";
import type { Model } from "./model";
export const pageContext = (model: Model): GenieContext => {
  const filters = filtersFromQuery(model.query);
  switch (model.path) {
    case "/trip-map":
      return gpsContext(model.gpsState, filters ?? {});
    case "/":
      return overviewContext(model.overviewState);
    case "/trips-preview":
      return gridContext(model.tripsState, filters);
    case "/trips":
      return tripsContext(model.tripsState, filters);
    default:
      return { page: "genie", title: "Taxi trip data" };
  }
};
