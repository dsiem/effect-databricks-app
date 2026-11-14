import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MapPin,
  MessageSquare,
} from "lucide-react";
import { useRef, useState } from "react";
import type { Trip, TripSearch } from "../../../src/domain";
import { api, apiClient, money, number, useFilters } from "../api";
import { ErrorState, Loading, PageTitle } from "../components/common";
import { AskGenieButton } from "../components/genie/helper";
import { useGeniePage } from "../components/genie/provider";
import { TripInspector } from "../components/trip-inspector";
import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
export default function TripExplorer() {
  const { filters, query } = useFilters();
  return <TripTable key={query} filters={filters} filterQuery={query} />;
}
function TripTable({
  filters,
  filterQuery,
}: {
  filters: TripSearch;
  filterQuery: string;
}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<NonNullable<TripSearch["sort"]>>("newest");
  const [selected, setSelected] = useState<Trip | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const inspect = (trip: Trip) => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSelected(trip);
    setInspectorOpen(true);
  };
  const trips = useQuery({
    queryKey: ["trips", filterQuery, page, sort],
    queryFn: ({ signal }) =>
      api(apiClient.trips({ query: { ...filters, page, sort } }), signal),
    staleTime: 60_000,
  });
  const context = {
    page: "trips" as const,
    title: `Trip records · page ${page}`,
    ...(trips.data && !trips.error
      ? {
          data: JSON.stringify({
            page,
            sort,
            totalMatchingTrips: trips.data.total,
            pageSize: trips.data.pageSize,
            visibleRows: trips.data.rows,
          }),
        }
      : {}),
  };
  useGeniePage(context);
  const exportCsv = () => {
    if (!trips.data) return;
    const fields = [
      "trip_id",
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
        description="Explore individual trips. Open a record to inspect its details and discuss it with your team."
        action={
          <div className="flex flex-wrap gap-2">
            <AskGenieButton
              context={context}
              question="Summarize the visible trips and point out unusual fares or distances."
            >
              Analyze these trips
            </AskGenieButton>
            <Button
              variant="outline"
              disabled={!trips.data?.rows.length}
              onClick={exportCsv}
            >
              <Download />
              Export this page
            </Button>
          </div>
        }
      />
      {trips.isPending ? (
        <Loading />
      ) : trips.error ? (
        <ErrorState error={trips.error} retry={() => void trips.refetch()} />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Trip records</h2>
              <Badge variant="secondary">
                {number(trips.data.total)} trips
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Sort by</span>
              <Select
                value={sort}
                onValueChange={(value) => {
                  if (
                    value === "newest" ||
                    value === "fare" ||
                    value === "distance"
                  )
                    setSort(value);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="Sort trips"
                  className="text-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Latest pickup</SelectItem>
                  <SelectItem value="fare">Highest fare</SelectItem>
                  <SelectItem value="distance">Longest distance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table className="w-full whitespace-nowrap text-left text-sm">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  {[
                    "Pickup time",
                    "Route · ZIP codes",
                    "Drop-off time",
                    "Distance",
                    "Duration",
                    "Fare",
                    "Discussion",
                  ].map((title, i) => (
                    <TableHead
                      key={title}
                      className={`px-5 py-4 font-medium ${i > 2 ? "text-right" : ""}`}
                    >
                      {title}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {trips.data.rows.map((trip) => (
                  <TableRow
                    key={trip.trip_id}
                    className="border-t transition-colors hover:bg-muted/40"
                  >
                    <TableCell className="px-5 py-4 font-medium tabular-nums">
                      <button
                        type="button"
                        className="text-left underline-offset-4 hover:underline focus-visible:underline"
                        onClick={() => inspect(trip)}
                      >
                        {trip.pickup_at}
                      </button>
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="size-3 text-primary" />
                        {trip.pickup_zip}
                        <span className="text-muted-foreground">→</span>
                        {trip.dropoff_zip}
                      </span>
                    </TableCell>
                    <TableCell className="px-5 py-4 text-muted-foreground tabular-nums">
                      {trip.dropoff_at}
                    </TableCell>
                    <TableCell className="px-5 py-4 text-right tabular-nums">
                      {trip.distance.toFixed(2)} mi
                    </TableCell>
                    <TableCell className="px-5 py-4 text-right tabular-nums">
                      {trip.duration.toFixed(1)} min
                    </TableCell>
                    <TableCell className="px-5 py-4 text-right font-medium tabular-nums">
                      {money(trip.fare, 2)}
                    </TableCell>
                    <TableCell className="px-5 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Details and comments for trip ${trip.pickup_at} from ${trip.pickup_zip} to ${trip.dropoff_zip}`}
                        onClick={() => inspect(trip)}
                      >
                        <MessageSquare className="size-4" />
                        Comment
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!trips.data.rows.length && (
              <div className="p-14 text-center text-sm text-muted-foreground">
                No trips match these filters.
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
            <span className="text-xs text-muted-foreground">
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
              <span className="text-sm">Page {page}</span>
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
      <p className="mt-4 text-sm text-muted-foreground">
        Source timestamps are shown as recorded. Fares are in USD and distances
        are in miles.
      </p>
      <TripInspector
        trip={selected}
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        opener={opener}
      />
    </>
  );
}
