import type { GenieContext } from "../../../../shared/domain";
import type { Model } from "./model";
export function gpsContext(model: Model): GenieContext {
  const endpoint = model.endpoint === "pickup" ? "pickups" : "drop-offs";
  const data = model.activity.data;
  const selected = data?.cells.find((cell) => cell.id === model.selected);
  return {
    page: "map",
    title: `GPS ${endpoint}`,
    ...(data &&
    !model.activity.loading &&
    !model.activity.error &&
    !model.mapError
      ? {
          data: JSON.stringify({
            endpoint: model.endpoint,
            matchingTrips: data.matchingTrips,
            locatedTrips: data.locatedTrips,
            shownTrips: data.shownTrips,
            truncated: data.truncated,
            resolution: 10,
            selectedArea: selected
              ? { ...selected, boundary: undefined }
              : null,
            topAreas: data.cells
              .slice(0, 5)
              .map(({ boundary: _, ...cell }) => cell),
            geography:
              "Hexagons aggregate actual GPS endpoints at H3 resolution 10. Cell centers are not individual trip locations. Date and ZIP filters apply to pickups.",
            queriedAt: data.queriedAt,
          }),
        }
      : {}),
  };
}
