import type { Filters, GenieContext } from "../../../../shared/domain";
import type { Model, Sort } from "./model";
export function tripsContext(
  state: Model,
  { filters, sort }: { filters: Filters | null; sort: typeof Sort.Type },
): GenieContext {
  const trips = state.trips.data;
  return {
    page: "trips",
    title: `Trip records · page ${state.page}`,
    ...(trips && !state.trips.loading && !state.trips.error
      ? {
          data: JSON.stringify({
            page: state.page,
            sort,
            totalMatchingTrips: trips.total,
            pageSize: trips.pageSize,
            filters: filters,
            scope: "page-subset",
            selectedTripId: state.selectedTrip?.trip_id ?? null,
            visibleCount: trips.rows.length,
            visibleSample: trips.rows.slice(0, 5),
          }),
        }
      : {}),
  };
}
