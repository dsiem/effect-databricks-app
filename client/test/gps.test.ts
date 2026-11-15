import assert from "node:assert/strict";
import { test } from "node:test";
import { Option } from "effect";
import { Url } from "foldkit";
import { Message as AppMessage } from "../src/app/message";
import { pageContext } from "../src/app/model";
import { init, update } from "../src/app/update";
import { gpsContext } from "../src/features/gps/context";
import { Message as M } from "../src/features/gps/messages";
import { dataKey, init as initGps } from "../src/features/gps/model";
import { updateGps } from "../src/features/gps/update";
import { gpsFixture } from "./gps-fixture";

test("stale endpoint, filter and render responses cannot replace the active GPS map", () => {
  const query = "from=2016-01-10";
  const model = { ...initGps(), endpoint: "dropoff" as const };
  for (const message of [
    M.LoadedGps({
      key: dataKey(query, "pickup"),
      data: gpsFixture(),
      error: "",
    }),
    M.LoadedGps({
      key: dataKey("", "dropoff"),
      data: gpsFixture("dropoff"),
      error: "",
    }),
    M.GpsReady({ key: dataKey(query, "pickup"), error: "Old renderer failed" }),
  ])
    assert.deepEqual(updateGps(model, message, { query }).model, model);
});

test("selection and Genie use the same GPS endpoint, counts and area without copying all geometry", () => {
  const activity = gpsFixture("dropoff");
  const model = {
    ...initGps(),
    endpoint: "dropoff" as const,
    activity: { data: activity, loading: false, error: "" },
  };
  const cell = activity.cells[0];
  assert.ok(cell);
  const selected = updateGps(model, M.GpsSelect({ id: cell.id }), {
    query: "",
  }).model;
  const context = gpsContext(selected);
  const data = JSON.parse(context.data ?? "{}");
  assert.equal(data.endpoint, "dropoff");
  assert.equal(data.resolution, 10);
  assert.equal(data.locatedTrips, 80);
  assert.equal(data.selectedArea.trips, 60);
  assert.equal(data.selectedArea.id, cell.id);
  assert.equal(data.selectedArea.boundary, undefined);
  assert.equal(
    updateGps(selected, M.GpsSelect({ id: null }), { query: "" }).model
      .selected,
    null,
  );
});

test("leaving the GPS page ignores its late responses and keeps the current page context", () => {
  const model = init(
    Option.getOrThrow(Url.fromString("http://localhost/trips")),
  ).model;
  const result = update(
    model,
    AppMessage.LoadedGps({
      key: dataKey("", "pickup"),
      data: gpsFixture(),
      error: "",
    }),
  );
  assert.deepEqual(result.model, model);
  assert.equal(pageContext(result.model).page, "trips");
});
