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
import { Badge, Card, cn } from "../components/ui";
import "leaflet/dist/leaflet.css";

type ZipProperties = { modzcta: string; label: string; zcta: string };
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
      ? "#e6eade"
      : ["#d9e4bd", "#bad18e", "#92b568", "#658c49", "#365a36"][
          Math.min(4, Math.floor(Math.sqrt(count / maximum) * 5))
        ];
  const mapped =
    geography.data?.features.reduce((sum, f) => sum + featureTrips(f), 0) ?? 0;
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
          <Badge className="border bg-card px-3 py-2">
            <MapPin className="size-3.5" />
            New York City
          </Badge>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Pickup activity</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Hover for trip counts. Click an area to filter.
              </p>
            </div>
            <Badge>{compact(mapped)} mapped trips</Badge>
          </div>
          <div className="map-panel h-[490px] sm:h-[570px]">
            <MapContainer
              center={[40.743, -73.94]}
              zoom={11}
              scrollWheelZoom={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <GeoJSON
                key={query}
                data={geography.data}
                style={(feature) => ({
                  color: "#fff",
                  weight: 1,
                  fillColor: color(
                    featureTrips(
                      feature as Feature<GeoJSON.Geometry, ZipProperties>,
                    ),
                  ),
                  fillOpacity: 0.8,
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
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-[10px] text-muted-foreground">
            <span>Modified ZIP areas · geographic aggregation</span>
            <span className="flex items-center gap-1.5">
              Fewer
              {["#d9e4bd", "#bad18e", "#92b568", "#658c49", "#365a36"].map(
                (c) => (
                  <span
                    key={c}
                    className="h-2 w-5 rounded-sm"
                    style={{ background: c }}
                  />
                ),
              )}
              More
            </span>
          </div>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <ChartTitle
              title="Pickup ZIP ranking"
              subtitle="ZIP codes ranked by recorded trips"
            />
            {zones.slice(0, 10).map((zone, index) => (
              <button
                type="button"
                key={zone.zip}
                onClick={() => setFilters({ ...filters, zip: zone.zip })}
                className={cn(
                  "mb-4 block w-full rounded-md text-left last:mb-0 hover:bg-muted/60",
                  filters.zip === zone.zip && "bg-muted",
                )}
              >
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span>
                    <span className="mr-2 text-[10px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="font-medium">{zone.zip}</span>
                  </span>
                  <span className="tabular-nums">{number(zone.trips)}</span>
                </div>
                <div className="ml-5 h-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-1 rounded bg-[#91ad70]"
                    style={{
                      width: `${(zone.trips / (zones[0]?.trips || 1)) * 100}%`,
                    }}
                  />
                </div>
              </button>
            ))}
          </Card>
          <Card className="bg-[#edf2e8] p-5">
            <p className="text-xs font-semibold">Geographic coverage</p>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              The sample has ZIP codes, not GPS coordinates. NYC Health’s
              modified ZIP areas group some postal ZIPs together. Trips outside
              these boundaries are included in totals, but are not drawn.
            </p>
            <p className="mt-3 text-[11px] font-medium">
              {number(
                Math.max(0, (overview.data?.summary.trips ?? 0) - mapped),
              )}{" "}
              trips outside mapped areas
            </p>
            <a
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-primary underline"
              href={source}
              target="_blank"
              rel="noreferrer"
            >
              Boundary source
              <ArrowUpRight className="size-3" />
            </a>
          </Card>
          {filters.zip && (
            <Card className="p-5">
              <p className="text-sm font-medium">Pickup ZIP {filters.zip}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {money(overview.data?.summary.revenue ?? 0)} in fare revenue
              </p>
              <Link
                className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary"
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
