import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Schema } from "effect";
import {
  Day,
  Filters,
  GenieInput,
  NoteInput,
  TripSearch,
} from "../src/domain.js";

test("accepts real historical dates and rejects impossible dates", () => {
  assert.equal(Schema.decodeUnknownSync(Day)("2016-02-29"), "2016-02-29");
  for (const date of ["2016-02-30", "2026-02-29", "2016-13-01", "now"])
    assert.throws(() => Schema.decodeUnknownSync(Day)(date));
});
test("rejects unsafe filters and pagination before SQL execution", () => {
  assert.throws(() =>
    Schema.decodeUnknownSync(Filters)({ zip: "10001' OR 1=1" }),
  );
  assert.throws(() => Schema.decodeUnknownSync(TripSearch)({ page: "0" }));
  assert.throws(() =>
    Schema.decodeUnknownSync(TripSearch)({ sort: "fare; DROP TABLE trips" }),
  );
  assert.deepEqual(
    Schema.decodeUnknownSync(TripSearch)({
      zip: "10001",
      page: "2",
      sort: "fare",
    }),
    { zip: "10001", page: 2, sort: "fare" },
  );
});
test("bounds notebook writes and conversational input", () => {
  const note = {
    id: "f9ca0a62-e2bc-4bc6-b27a-8c37cdd7d784",
    title: "A finding",
    body: "Notes",
    filters: { zip: "10001" },
    version: null,
  };
  assert.deepEqual(Schema.decodeUnknownSync(NoteInput)(note), note);
  assert.throws(() =>
    Schema.decodeUnknownSync(NoteInput)({
      ...note,
      id: "------------------------------------",
    }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(NoteInput)({ ...note, body: "x".repeat(10001) }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(GenieInput)({
      content: "",
      conversationId: "x/y",
    }),
  );
});
test("bundled map boundaries have unique ZIP memberships, avoiding double-counted trips", () => {
  const geo = JSON.parse(
    readFileSync("client/public/nyc-zips.geojson", "utf8"),
  );
  assert.equal(geo.type, "FeatureCollection");
  const memberships = new Set<string>();
  for (const feature of geo.features) {
    assert.ok(["Polygon", "MultiPolygon"].includes(feature.geometry.type));
    for (const zip of feature.properties.zcta
      .split(",")
      .map((zip: string) => zip.trim())) {
      assert.match(zip, /^\d{5}$/);
      assert.ok(!memberships.has(zip), `ZIP ${zip} must map to only one area`);
      memberships.add(zip);
    }
  }
});
