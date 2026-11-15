import { ArcLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { Map as LibreMap, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import data from "../../.databricks/map-prototypes/data.json";
import "./style.css";

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing prototype element: ${id}`);
  return value;
}
const number = new Intl.NumberFormat("en-US");
element("scope").textContent =
  `${number.format(data.metadata.trips)} trips · ${number.format(data.metadata.pickups)} recorded pickup locations`;
element("sample").textContent =
  `${number.format(data.points.length)} sampled pickups`;
const maps: LibreMap[] = [];
Object.assign(window, { mapStudy: maps });
const maximum = Math.max(...data.density.map((cell) => cell.trips));
const intensity = (trips: number) => (trips / maximum) ** 0.32;
const palette = (trips: number): [number, number, number, number] => {
  const value = intensity(trips);
  return [
    Math.round(150 - value * 80),
    Math.round(190 - value * 140),
    Math.round(235 - value * 45),
    Math.round(80 + value * 160),
  ];
};
for (const id of ["points", "density", "flows"]) {
  const map = new LibreMap({
    container: id,
    center: [-73.965, 40.745],
    zoom: 10.5,
    style: {
      version: 8,
      sources: {
        streets: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap",
        },
      },
      layers: [
        {
          id: "streets",
          type: "raster",
          source: "streets",
          paint: { "raster-saturation": -1, "raster-opacity": 0.65 },
        },
      ],
    },
    dragRotate: false,
    pitchWithRotate: false,
  });
  maps.push(map);
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  const popup = new Popup({ closeButton: false, closeOnClick: false });
  const layers =
    id === "points"
      ? [
          new ScatterplotLayer({
            id: "sample-points",
            data: data.points,
            pickable: true,
            getPosition: (d) => [d.longitude, d.latitude],
            getRadius: 18,
            radiusMinPixels: 1.2,
            getFillColor: [79, 70, 229, 95],
          }),
        ]
      : id === "density"
        ? [
            new PolygonLayer({
              id: "density-cells",
              data: data.density,
              pickable: true,
              getPolygon: (d) => d.polygon,
              getFillColor: (d) => palette(d.trips),
              getLineColor: [255, 255, 255, 90],
              stroked: true,
              lineWidthMinPixels: 0.5,
              autoHighlight: true,
              highlightColor: [249, 168, 37, 150],
            }),
          ]
        : [
            new ArcLayer({
              id: "trip-flows",
              data: [...data.flows].reverse(),
              pickable: true,
              getSourcePosition: (d) => d.origin,
              getTargetPosition: (d) => d.destination,
              getSourceColor: [79, 70, 229, 160],
              getTargetColor: [13, 148, 136, 200],
              getWidth: (d) => 1 + 5 * Math.sqrt(d.trips / data.flows[0].trips),
              getHeight: 0.3,
            }),
          ];
  const deck = new MapLibreOverlay({ layers });
  map.addControl(deck);
  map.on("mousemove", (event) => {
    const hit = deck.pickObject({
      x: event.point.x,
      y: event.point.y,
      radius: 5,
    });
    const row = hit?.object;
    map.getCanvas().style.cursor = row ? "pointer" : "";
    if (!row) {
      popup.remove();
      return;
    }
    popup
      .setLngLat(event.lngLat)
      .setText(
        id === "points"
          ? `Sampled trip · $${row.fare.toFixed(2)} · ${row.distance.toFixed(1)} miles`
          : id === "density"
            ? `${number.format(row.trips)} pickups · $${row.fare.toFixed(2)} average fare`
            : `${number.format(row.trips)} trips · connection between areas`,
      )
      .addTo(map);
  });
  map.on("mouseout", () => popup.remove());
  map.once("idle", () => (element(id).dataset.ready = "true"));
}
element("city").addEventListener("click", () =>
  maps.forEach((map) => {
    map.easeTo({ center: [-73.965, 40.745], zoom: 10.5 });
  }),
);
element("street").addEventListener("click", () =>
  maps.forEach((map) => {
    map.easeTo({ center: [-73.985, 40.749], zoom: 13.6 });
  }),
);
