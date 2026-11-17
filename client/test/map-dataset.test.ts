import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { MapSummary } from "../../shared/map-dataset";
import { jsonMap, pickedIndex } from "../src/features/gps/dataset";
import { gpsFixture } from "./gps-fixture";

test("map resources preserve cells and picking while keeping geometry out of summaries", () => {
  const fixture = gpsFixture();
  const resource = jsonMap(fixture);
  for (const [i, row] of fixture.cells.entries()) {
    const { boundary, ...summary } = row;
    assert.deepEqual(resource.cell(i), summary);
    assert.deepEqual(resource.ring(i), boundary.coordinates[0]);
    assert.equal(resource.index(row.id), i);
    assert.equal(pickedIndex(resource, "gps-cells", i), i);
  }
  assert.equal(pickedIndex(resource, "gps-cells", fixture.cells.length), -1);
  assert.equal(pickedIndex(resource, "gps-selection", 0), -1);
  assert.equal(pickedIndex(resource, "gps-cells", -1), -1);
  assert.equal(pickedIndex(resource, "gps-cells", NaN), -1);
  assert.ok(Schema.is(MapSummary)(resource.summary));
  assert.equal(JSON.stringify(resource.summary).includes("coordinates"), false);
  resource.release();
  assert.equal(resource.rows.length, 0);
  assert.equal(resource.cell(0), undefined);
  assert.deepEqual(resource.ring(0), []);
  assert.equal(resource.index(fixture.cells[0]?.id ?? ""), -1);
  assert.equal(pickedIndex(resource, "gps-cells", 0), -1);
});

test("map summaries stay bounded for empty and large datasets", () => {
  const fixture = gpsFixture();
  const empty = jsonMap({ ...fixture, cells: [] });
  assert.deepEqual(empty.summary.cells, []);
  assert.equal(empty.summary.loaded, 0);
  assert.equal(empty.cell(0), undefined);
  const first = fixture.cells[0];
  assert.ok(first);
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    ...first,
    id: `cell-${i}`,
  }));
  const data = jsonMap({ ...fixture, cells: rows });
  assert.equal(data.summary.cells.length, 5);
  assert.equal(data.summary.loaded, 1000);
  assert.ok(JSON.stringify(data.summary).length < 2000);
});

test("map resources reject duplicate identities and datasets over the row budget", () => {
  const fixture = gpsFixture();
  const first = fixture.cells[0];
  assert.ok(first);
  assert.throws(
    () => jsonMap({ ...fixture, cells: [first, first] }),
    /Duplicate map cell/,
  );
  assert.throws(
    () => jsonMap({ ...fixture, cells: Array(100001).fill(first) }),
    /Map budget exceeded/,
  );
});
