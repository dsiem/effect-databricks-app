import type { Color } from "@deck.gl/core";
import { GeoJsonLayer } from "@deck.gl/layers";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { Deferred, Effect, Queue, Stream, SubscriptionRef } from "effect";
import type { Mount } from "foldkit";
import {
  Map as LibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  activityColors,
  type Geography,
  type PickupProperties,
  pickupAreas,
} from "./geography";
import type { MapData, MapEvent } from "./mount";
import { Message as M } from "./view-messages";

setWorkerUrl(workerUrl);
const tripsFormat = new Intl.NumberFormat("en-US");
const renderError =
  "Unable to render the pickup map. Check WebGL support and try again.";

// Resolve the legend's CSS colors, including color-mix and theme tokens, to
// the numeric RGBA values that WebGL accepts.
function mapColors(element: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Unable to resolve map colors");
  const probe = document.createElement("span");
  probe.hidden = true;
  element.append(probe);
  const resolve = (color: string): Color => {
    probe.style.color = color;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(
      0,
      0,
      1,
      1,
    ).data;
    return [r, g, b, a];
  };
  try {
    return {
      surface: resolve("var(--surface)"),
      subtle: resolve("var(--subtle)"),
      activity: activityColors.map(resolve),
    };
  } finally {
    probe.remove();
  }
}

export function mountPickupMap(
  element: HTMLElement,
  geography: Geography,
  inputs: SubscriptionRef.SubscriptionRef<MapData>,
  viewStateChanges: Stream.Stream<Mount.ViewState>,
  queue: Queue.Enqueue<MapEvent>,
) {
  return Effect.gen(function* () {
    const styled = yield* Deferred.make<void>();
    const map = yield* Effect.acquireRelease(
      Effect.try(
        () =>
          new LibreMap({
            container: element,
            center: [-73.94, 40.743],
            zoom: 10,
            scrollZoom: true,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            style: {
              version: 8,
              sources: {
                streets: {
                  type: "raster",
                  tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                  tileSize: 256,
                  maxzoom: 19,
                  attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                },
              },
              layers: [
                {
                  id: "streets",
                  type: "raster",
                  source: "streets",
                  paint: { "raster-saturation": -1 },
                },
              ],
            },
          }),
      ),
      (map) =>
        Effect.sync(() => {
          map.remove();
          element.inert = false;
        }),
    );
    map.once("style.load", () => Deferred.doneUnsafe(styled, Effect.void));
    yield* Deferred.await(styled);
    const initialData = yield* SubscriptionRef.get(inputs);
    yield* Effect.try(() => {
      let data = initialData;
      let areas = pickupAreas(geography, data.zones);
      let rendered: MapData | undefined;
      let live = false;
      const popup = new Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "map-tooltip",
      });
      map.on("remove", () => popup.remove());
      map.getCanvas().setAttribute("aria-label", "Pickup activity by ZIP area");
      map.addControl(new NavigationControl({ showCompass: false }), "top-left");
      map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      // MapLibre owns the overlay as a control and finalizes it on map removal.
      const deck = new MapLibreOverlay({
        interleaved: true,
        onAfterRender: () => {
          if (data.loading || rendered === data) return;
          rendered = data;
          updateInteraction();
          Queue.offerUnsafe(
            queue,
            M.MapReady({ query: data.query, mapped: areas.mapped, error: "" }),
          );
        },
        onError: () => {
          Queue.offerUnsafe(
            queue,
            M.MapReady({
              query: data.query,
              mapped: 0,
              error: renderError,
            }),
          );
        },
      });
      const redraw = () => {
        const colors = mapColors(element);
        const { features, maximum } = areas;
        map.setPaintProperty(
          "streets",
          "raster-brightness-max",
          document.documentElement.classList.contains("dark") ? 0.45 : 1,
        );
        deck.setProps({
          layers: [
            new GeoJsonLayer<PickupProperties>({
              id: "pickup-areas",
              data: { type: "FeatureCollection", features },
              pickable: true,
              filled: true,
              stroked: true,
              opacity: 0.85,
              getLineColor: colors.surface,
              lineWidthUnits: "pixels",
              getLineWidth: 1,
              getFillColor: ({ properties: { trips } }) =>
                trips === 0
                  ? colors.subtle
                  : (colors.activity[
                      Math.min(4, Math.floor(Math.sqrt(trips / maximum) * 5))
                    ] ?? colors.subtle),
              updateTriggers: {
                getFillColor: [features, colors],
                getLineColor: [colors],
              },
            }),
          ],
        });
      };
      const updateInteraction = () => {
        const enabled = live && !data.loading && rendered === data;
        element.inert = !enabled;
        for (const handler of [
          map.dragPan,
          map.scrollZoom,
          map.doubleClickZoom,
          map.boxZoom,
          map.keyboard,
          map.touchZoomRotate,
        ])
          enabled ? handler.enable() : handler.disable();
        if (!enabled) popup.remove();
      };
      map.addControl(deck);
      const pick = (x: number, y: number) => {
        const hit = deck.pickObject({ x, y, radius: 2 });
        return hit ? areas.features[hit.index] : undefined;
      };
      map.on("mousemove", (event) => {
        if (element.inert) return;
        const feature = pick(event.point.x, event.point.y);
        map.getCanvas().style.cursor = feature ? "pointer" : "";
        if (feature)
          popup
            .setLngLat(event.lngLat)
            .setText(
              `ZIP ${feature.properties.label} · ${tripsFormat.format(feature.properties.trips)} trips`,
            )
            .addTo(map);
        else popup.remove();
      });
      map.on("mouseout", () => popup.remove());
      map.on("click", (event) => {
        if (element.inert) return;
        const feature = pick(event.point.x, event.point.y);
        if (feature)
          Queue.offerUnsafe(
            queue,
            M.SelectZip({ zip: feature.properties.zip }),
          );
      });
      const theme = new MutationObserver(redraw);
      map.on("remove", () => theme.disconnect());
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      redraw();
      updateInteraction();
      return Effect.all(
        [
          Stream.runForEach(SubscriptionRef.changes(inputs), (next) =>
            Effect.try(() => {
              if (next === data) return;
              data = next;
              areas = pickupAreas(geography, data.zones);
              popup.remove();
              redraw();
              updateInteraction();
            }),
          ),
          Stream.runForEach(viewStateChanges, (state) =>
            Effect.try(() => {
              live = state === "Live";
              updateInteraction();
            }),
          ),
        ],
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.flatten);
  }).pipe(
    Effect.scoped,
    Effect.mapError(() => renderError),
  );
}
