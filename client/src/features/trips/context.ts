import type { Filters, GenieContext } from "../../../../shared/domain";
import type { Model } from "./model";
export function gridContext(
  state: Model,
  filters: Filters | null,
): GenieContext {
  const window = state.gridWindow;
  return {
    page: "trips",
    title: "Matching trip summaries",
    data: JSON.stringify({
      query: { filters: filters, sort: state.sort },
      scope: state.gridStatus.scope,
      loading: state.gridStatus.loading,
      error: state.gridStatus.error,
      totalMatchingTrips: state.gridStatus.total,
      loadedTrips: state.gridStatus.loaded,
      selectedTripId: state.selectedTrip?.trip_id ?? null,
      ...(window && window.key === state.gridKey && !state.gridStatus.error
        ? {
            snapshot: window.snapshot,
            visibleStart: window.start,
            visibleCount: window.visible,
            visibleSample: window.sample,
          }
        : {}),
    }),
  };
}
export function tripsContext(
  state: Model,
  filters: Filters | null,
): GenieContext {
  const trips = state.trips.data;
  return {
    page: "trips",
    title: `Trip records · page ${state.page}`,
    ...(trips && !state.trips.loading && !state.trips.error
      ? {
          data: JSON.stringify({
            page: state.page,
            sort: state.sort,
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
