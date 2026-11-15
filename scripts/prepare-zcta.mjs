import { writeFile } from "node:fs/promises";

// ZCTAs are geographic ZIP proxies, not postal addresses or 2016 boundaries.
const source =
  "https://data.cityofnewyork.us/resource/35j5-n34v.geojson?$limit=1000";
const response = await fetch(source);
if (!response.ok) throw new Error(`ZCTA download failed: ${response.status}`);
const data = await response.json();
if (data.type !== "FeatureCollection" || data.features.length < 150)
  throw new Error("Expected the complete NYC ZCTA boundary collection");
const rows = data.features.map(({ properties, geometry }) => {
  const zip = properties.zcta5;
  if (
    !/^\d{5}$/.test(zip) ||
    !["Polygon", "MultiPolygon"].includes(geometry.type)
  )
    throw new Error("Invalid ZCTA boundary");
  const positions = geometry.coordinates.flat(
    geometry.type === "Polygon" ? 1 : 2,
  );
  return {
    zip,
    geometry: JSON.stringify(geometry),
    min_x: Math.min(...positions.map(([x]) => x)),
    max_x: Math.max(...positions.map(([x]) => x)),
    min_y: Math.min(...positions.map(([, y]) => y)),
    max_y: Math.max(...positions.map(([, y]) => y)),
  };
});
rows.sort((a, b) => a.zip.localeCompare(b.zip));
await writeFile(
  "jobs/nyc-zcta.jsonl",
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
);
console.log(`Saved ${rows.length} ZCTA boundaries from ${source}`);
