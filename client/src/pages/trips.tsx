import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, MapPin } from "lucide-react";
import { useState } from "react";
import { Trips } from "../../../src/domain";
import { api, money, number, useFilters } from "../api";
import { ErrorState, Loading, PageTitle } from "../components/common";
import { Badge, Button, Card } from "../components/ui";
export default function TripExplorer() {
  const { query } = useFilters();
  return <TripTable key={query} filterQuery={query} />;
}
function TripTable({ filterQuery }: { filterQuery: string }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("newest");
  const trips = useQuery({
    queryKey: ["trips", filterQuery, page, sort],
    queryFn: ({ signal }) =>
      api(
        `/api/trips?${filterQuery}&page=${page}&sort=${sort}`,
        Trips,
        {},
        signal,
      ),
    staleTime: 60_000,
  });
  const exportCsv = () => {
    if (!trips.data) return;
    const fields = [
      "pickup_at",
      "dropoff_at",
      "pickup_zip",
      "dropoff_zip",
      "distance",
      "fare",
      "duration",
    ] as const;
    const text = [
      fields.join(","),
      ...trips.data.rows.map((row) =>
        fields
          .map((field) => `"${String(row[field]).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `taxi-trips-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageTitle
        title="Trip records"
        description="Filter trip records by pickup date and ZIP code, sort results, and export the current page as CSV."
        action={
          <Button
            variant="outline"
            disabled={!trips.data?.rows.length}
            onClick={exportCsv}
          >
            <Download />
            Export this page
          </Button>
        }
      />
      {trips.isPending ? (
        <Loading />
      ) : trips.error ? (
        <ErrorState error={trips.error} retry={() => void trips.refetch()} />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Trip records</h2>
              <Badge>{number(trips.data.total)} trips</Badge>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Sort by
              <select
                aria-label="Sort trips"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className="h-8 rounded-md border bg-card px-2 text-xs text-foreground"
              >
                <option value="newest">Latest pickup</option>
                <option value="fare">Highest fare</option>
                <option value="distance">Longest distance</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="bg-muted/40 text-[10px] text-muted-foreground">
                <tr>
                  {[
                    "Pickup time",
                    "Route · ZIP codes",
                    "Drop-off time",
                    "Distance",
                    "Duration",
                    "Fare",
                  ].map((title, i) => (
                    <th
                      key={title}
                      className={`px-5 py-4 font-medium ${i > 2 ? "text-right" : ""}`}
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trips.data.rows.map((trip, i) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: Immutable trip snapshots can contain identical rows without source IDs.
                    key={`${trip.pickup_at}-${trip.dropoff_at}-${i}`}
                    className="border-t transition-colors hover:bg-muted/40"
                  >
                    <td className="px-5 py-4 font-medium tabular-nums">
                      {trip.pickup_at}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="size-3 text-primary" />
                        {trip.pickup_zip}
                        <span className="text-muted-foreground">→</span>
                        {trip.dropoff_zip}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground tabular-nums">
                      {trip.dropoff_at}
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      {trip.distance.toFixed(2)} mi
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      {trip.duration.toFixed(1)} min
                    </td>
                    <td className="px-5 py-4 text-right font-medium tabular-nums">
                      {money(trip.fare, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!trips.data.rows.length && (
              <div className="p-14 text-center text-sm text-muted-foreground">
                No trips match these filters.
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
            <span className="text-[11px] text-muted-foreground">
              {trips.data.total
                ? `${number((page - 1) * 25 + 1)}–${number(Math.min(page * 25, trips.data.total))} of ${number(trips.data.total)}`
                : "0 records"}
            </span>
            <div className="flex items-center gap-3">
              <Button
                aria-label="Previous page"
                variant="outline"
                size="icon"
                disabled={page === 1 || trips.isFetching}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </Button>
              <span className="text-xs">Page {page}</span>
              <Button
                aria-label="Next page"
                variant="outline"
                size="icon"
                disabled={page * 25 >= trips.data.total || trips.isFetching}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Source timestamps are shown as recorded. Fares are in USD and distances
        are in miles.
      </p>
    </>
  );
}
