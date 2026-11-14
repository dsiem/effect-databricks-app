import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";
import type { FeatureCollection } from "geojson";
import * as D from "../../../../shared/domain";
import { Message as M } from "./view-messages";

const Position = Schema.Array(Schema.Number);
const PolygonCoordinates = Schema.Array(Schema.Array(Position));
const Geometry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("Polygon"),
    coordinates: PolygonCoordinates,
  }),
  Schema.Struct({
    type: Schema.Literal("MultiPolygon"),
    coordinates: Schema.Array(PolygonCoordinates),
  }),
]);
const Geography = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("Feature"),
      properties: Schema.Struct({
        label: Schema.String,
        zcta: Schema.String,
        modzcta: Schema.String,
      }),
      geometry: Geometry,
    }),
  ),
});
export const activityColors = [20, 40, 60, 80, 100].map(
  (amount) => `color-mix(in oklab, var(--color-blue-700) ${amount}%, white)`,
);
export const MapMount = Mount.defineStream("PickupMap", {
  args: { zones: Schema.Array(D.Zone), query: Schema.String },
  messages: [M.MapReady, M.PickZip],
  execute: ({ element, zones, query, viewStateChanges }) =>
    Stream.callback<
      ReturnType<typeof M.MapReady> | ReturnType<typeof M.PickZip>
    >((queue) =>
      Effect.gen(function* () {
        const [L, geography] = yield* Effect.all([
          Effect.tryPromise(() => import("leaflet")),
          Effect.tryPromise(async (signal) => {
            const response = await fetch("/nyc-zips.geojson", { signal });
            if (!response.ok) throw new Error("Unable to load NYC boundaries");
            return Schema.decodeUnknownSync(Geography)(await response.json());
          }),
        ]);
        const byZip = new Map(zones.map((zone) => [zone.zip, zone]));
        const count = (zips: string) =>
          zips
            .split(",")
            .reduce((sum, zip) => sum + (byZip.get(zip.trim())?.trips ?? 0), 0);
        const maximum = Math.max(
          1,
          ...geography.features.map((feature) =>
            count(feature.properties.zcta),
          ),
        );
        let live = true;
        const map = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const map = L.map(element as HTMLElement, {
              center: [40.743, -73.94],
              zoom: 11,
              scrollWheelZoom: true,
            });
            L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            }).addTo(map);
            L.geoJSON(geography as unknown as FeatureCollection, {
              style: (feature) => {
                const trips = count(feature?.properties.zcta ?? "");
                return {
                  color: "white",
                  weight: 1,
                  fillOpacity: 0.85,
                  fillColor:
                    trips === 0
                      ? "var(--color-gray-100)"
                      : (activityColors[
                          Math.min(
                            4,
                            Math.floor(Math.sqrt(trips / maximum) * 5),
                          )
                        ] ?? "var(--color-gray-100)"),
                };
              },
              onEachFeature: (feature, layer) => {
                const label = document.createElement("span");
                label.textContent = `ZIP ${feature.properties.label} · ${new Intl.NumberFormat("en-US").format(count(feature.properties.zcta))} trips`;
                layer.bindTooltip(label, { sticky: true });
                layer.on("click", () => {
                  if (!live) return;
                  const selected = String(feature.properties.zcta)
                    .split(",")
                    .map((zip) => zip.trim())
                    .sort(
                      (a, b) =>
                        (byZip.get(b)?.trips ?? 0) - (byZip.get(a)?.trips ?? 0),
                    )[0];
                  if (selected)
                    Queue.offerUnsafe(queue, M.PickZip({ zip: selected }));
                });
              },
            }).addTo(map);
            return map;
          }),
          (map) => Effect.sync(() => map.remove()),
        );
        yield* Effect.forkScoped(
          Stream.runForEach(viewStateChanges, (state) =>
            Effect.sync(() => {
              live = state === "Live";
              for (const handler of [
                map.dragging,
                map.scrollWheelZoom,
                map.doubleClickZoom,
                map.keyboard,
                map.touchZoom,
              ])
                live ? handler.enable() : handler.disable();
            }),
          ),
        );
        const observer = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observer = new ResizeObserver(() => map.invalidateSize());
            observer.observe(element);
            return observer;
          }),
          (observer) => Effect.sync(() => observer.disconnect()),
        );
        void observer;
        Queue.offerUnsafe(
          queue,
          M.MapReady({
            query,
            mapped: geography.features.reduce(
              (sum, feature) => sum + count(feature.properties.zcta),
              0,
            ),
            error: "",
          }),
        );
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            Queue.offerUnsafe(
              queue,
              M.MapReady({
                query,
                mapped: 0,
                error:
                  "Unable to load the bundled NYC geographic boundaries. Try again.",
              }),
            );
          }),
        ),
      ),
    ),
});
