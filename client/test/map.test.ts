import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseGeography, pickupAreas } from "../src/features/map/geography";

const geography = parseGeography(
  JSON.parse(
    readFileSync(
      new URL("../public/nyc-zips.geojson", import.meta.url),
      "utf8",
    ),
  ),
);

test("the geography boundary rejects malformed postal ZIP lists", () => {
  for (const zcta of ["", "10001,,10119", "10001, invalid"]) {
    assert.throws(() =>
      parseGeography({
        type: "FeatureCollection",
        features: [
          {
            ...geography.features[0],
            properties: { label: "10001", modzcta: "10001", zcta },
          },
        ],
      }),
    );
  }
});

test("a modified ZIP area aggregates postal ZIPs and selects its busiest ZIP", () => {
  const result = pickupAreas(geography, [
    { zip: "10001", trips: 12, revenue: 100, avg_fare: 8 },
    { zip: "10119", trips: 30, revenue: 200, avg_fare: 7 },
    { zip: "90210", trips: 5, revenue: 50, avg_fare: 10 },
  ]);
  const area = result.features.find(
    (feature) => feature.properties.modzcta === "10001",
  );
  assert.equal(area?.properties.trips, 42);
  assert.equal(area?.properties.zip, "10119");
  assert.equal(result.mapped, 42);
  assert.equal(result.maximum, 42);
});

test("empty pickup data keeps geographic areas selectable with finite coloring", () => {
  const result = pickupAreas(geography, []);
  assert.equal(result.mapped, 0);
  assert.equal(result.maximum, 1);
  assert.ok(
    result.features.every(
      (feature) => feature.properties.trips === 0 && feature.properties.zip,
    ),
  );
});
