import { useQuery } from "@tanstack/react-query";
import type { Feature, FeatureCollection } from "geojson";
import type { Layer } from "leaflet";
import { ArrowUpRight, MapPin } from "lucide-react";
import { useMemo } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import { Link } from "react-router-dom";
import { compact, money, number, useFilters, useOverview } from "../api";
import {
  ChartTitle,
  ErrorState,
  Loading,
  PageTitle,
} from "../components/common";
import { AskGenieButton } from "../components/genie/helper";
import { useGeniePage } from "../components/genie/provider";
import { Badge, Card, cn } from "../components/ui";
import "leaflet/dist/leaflet.css";

type ZipProperties = { modzcta: string; label: string; zcta: string };
const activityColors = [20, 40, 60, 80, 100].map(
  (amount) =>
    `color-mix(in oklab, var(--chart-2) ${amount}%, var(--background))`,
);
const source =
  "https://data.cityofnewyork.us/Health/Modified-Zip-Code-Tabulation-Areas-MODZCTA-/pri4-ifjk";
export default function PickupMap() {
  const overview = useOverview();
  const { filters, setFilters, query } = useFilters();
  const geography = useQuery({
    queryKey: ["geography"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/nyc-zips.geojson", { signal });
      if (!response.ok)
        throw new Error(
          "Unable to load the bundled NYC geographic boundaries.",
        );
      return (await response.json()) as FeatureCollection<
        GeoJSON.Geometry,
        ZipProperties
      >;
    },
    staleTime: Infinity,
  });
  const zones = overview.data?.zones ?? [];
  const byZip = useMemo(
    () => new Map(zones.map((zone) => [zone.zip, zone])),
    [zones],
  );
  const featureTrips = (feature: Feature<GeoJSON.Geometry, ZipProperties>) =>
    feature.properties.zcta
      .split(",")
      .reduce((sum, zip) => sum + (byZip.get(zip.trim())?.trips ?? 0), 0);
  const maximum = Math.max(
    1,
    ...(geography.data?.features.map(featureTrips) ?? []),
  );
  const color = (count: number) =>
    count === 0
      ? "var(--muted)"
      : activityColors[Math.min(4, Math.floor(Math.sqrt(count / maximum) * 5))];
  const mapped =
    geography.data?.features.reduce((sum, f) => sum + featureTrips(f), 0) ?? 0;
  useGeniePage({
    page: "map",
    title: "Pickup activity by ZIP area",
    ...(overview.data && geography.data && !overview.error && !geography.error
      ? {
          data: JSON.stringify({
            topPickupZIPs: zones.slice(0, 10),
            totalTrips: overview.data.summary.trips,
            mappedTrips: geography.data ? mapped : null,
            geography:
              "NYC Health MODZCTA; postal ZIPs may be grouped; trips outside boundaries are not drawn.",
            queriedAt: overview.data.queriedAt,
          }),
        }
      : {}),
  });
  if (overview.isPending || geography.isPending)
    return (
      <>
        <PageTitle
          title="Pickups by ZIP area"
          description="Trip counts aggregated by pickup ZIP code for the selected filters."
        />
        <Loading text="Loading pickup activity and NYC boundaries…" />
      </>
    );
  if (overview.error || geography.error)
    return (
      <ErrorState
        error={
          overview.error ?? geography.error ?? new Error("Map unavailable")
        }
        retry={() => {
          void overview.refetch();
          void geography.refetch();
        }}
      />
    );
  return (
    <>
      <PageTitle
        title="Pickups by ZIP area"
        description="Trip counts aggregated by pickup ZIP code for the selected filters."
        action={
          <Badge variant="outline" className="px-3 py-2">
            <MapPin className="size-3.5" />
            New York City
          </Badge>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Pickup activity</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Scroll to zoom. Select an area to filter.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{compact(mapped)} mapped trips</Badge>
              <AskGenieButton question="Explain the pickup distribution in this map and compare the busiest areas.">
                Explain map
              </AskGenieButton>
            </div>
          </div>
          <div className="map-panel h-[420px] shrink-0 sm:h-[570px]">
            <MapContainer center={[40.743, -73.94]} zoom={11} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <GeoJSON
                key={query}
                data={geography.data}
                style={(feature) => ({
                  color: "var(--background)",
                  weight: 1,
                  fillColor: color(
                    featureTrips(
                      feature as Feature<GeoJSON.Geometry, ZipProperties>,
                    ),
                  ),
                  fillOpacity: 0.85,
                })}
                onEachFeature={(
                  feature: Feature<GeoJSON.Geometry, ZipProperties>,
                  layer: Layer,
                ) => {
                  const count = featureTrips(feature);
                  layer.bindTooltip(
                    `ZIP ${feature.properties.label} · ${number(count)} trips`,
                    { sticky: true },
                  );
                  layer.on("click", () => {
                    const candidates = feature.properties.zcta
                      .split(",")
                      .map((zip) => zip.trim());
                    const selected = candidates.sort(
                      (a, b) =>
                        (byZip.get(b)?.trips ?? 0) - (byZip.get(a)?.trips ?? 0),
                    )[0];
                    if (selected) setFilters({ ...filters, zip: selected });
                  });
                }}
              />
            </MapContainer>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
            <span>Modified ZIP areas · geographic aggregation</span>
            <span className="flex items-center gap-1.5">
              Fewer
              {activityColors.map((c) => (
                <span
                  key={c}
                  className="h-2 w-5 rounded-sm"
                  style={{ background: c }}
                />
              ))}
              More
            </span>
          </div>
        </Card>
        <div className="space-y-5">
          <Card className="gap-0 p-5">
            <ChartTitle
              title="Pickup ZIP ranking"
              subtitle="ZIP codes ranked by recorded trips"
            />
            <ol aria-label="Pickup ZIP ranking" className="space-y-1">
              {zones.slice(0, 10).map((zone, index) => (
                <li key={zone.zip}>
                  <button
                    type="button"
                    aria-label={`Rank ${index + 1}, ZIP ${zone.zip}, ${number(zone.trips)} trips`}
                    aria-pressed={filters.zip === zone.zip}
                    onClick={() => setFilters({ ...filters, zip: zone.zip })}
                    className={cn(
                      "grid w-full grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      filters.zip === zone.zip && "bg-muted",
                    )}
                  >
                    <span className="flex size-7 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 space-y-2">
                      <span className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{zone.zip}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {number(zone.trips)}
                        </span>
                      </span>
                      <span className="block h-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-chart-2"
                          style={{
                            width: `${(zone.trips / (zones[0]?.trips || 1)) * 100}%`,
                          }}
                        />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="gap-0 bg-muted/40 p-5">
            <p className="text-sm font-semibold">Geographic coverage</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              The sample has ZIP codes, not GPS coordinates. NYC Health’s
              modified ZIP areas group some postal ZIPs together. Trips outside
              these boundaries are included in totals, but are not drawn.
            </p>
            <p className="mt-3 text-xs font-medium">
              {number(
                Math.max(0, (overview.data?.summary.trips ?? 0) - mapped),
              )}{" "}
              trips outside mapped areas
            </p>
            <a
              className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline"
              href={source}
              target="_blank"
              rel="noreferrer"
            >
              Boundary source
              <ArrowUpRight className="size-3" />
            </a>
          </Card>
          {filters.zip && (
            <Card className="gap-0 p-5">
              <p className="text-sm font-medium">Pickup ZIP {filters.zip}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {money(overview.data?.summary.revenue ?? 0)} in fare revenue
              </p>
              <Link
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary"
                to={`/trips?${query}`}
              >
                View trip records
                <ArrowUpRight className="size-3" />
              </Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
