import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const response = await fetch(
  "https://data.cityofnewyork.us/resource/pri4-ifjk.geojson?$limit=300",
  { signal: AbortSignal.timeout(30000) },
);
assert.ok(response.ok, `NYC Open Data returned ${response.status}`);
const geo = await response.json();
assert.equal(geo.type, "FeatureCollection");
assert.ok(
  geo.features.length > 0 && geo.features.length < 300,
  "Check for pagination before replacing the boundary collection",
);
const round = (value) =>
  typeof value === "number"
    ? Math.round(value * 100000) / 100000
    : value.map(round);
for (const feature of geo.features) {
  assert.equal(typeof feature.properties.zcta, "string");
  feature.geometry.coordinates = round(feature.geometry.coordinates);
}
await writeFile("client/public/nyc-zips.geojson", JSON.stringify(geo));
console.log(`Saved ${geo.features.length} official NYC ZIP areas`);
