import assert from "node:assert/strict";
import { test } from "node:test";
import { Option } from "effect";
import { Url } from "foldkit";
import { Message as AppMessage } from "../src/app/message";
import { pageContext } from "../src/app/model";
import { init, update } from "../src/app/update";
import { gpsContext } from "../src/features/gps/context";
import { jsonMap } from "../src/features/gps/dataset";
import { Message as M } from "../src/features/gps/messages";
import { dataKey, frameKey, init as initGps } from "../src/features/gps/model";
import { reloadGps, updateGps } from "../src/features/gps/update";
import { gpsFixture } from "./gps-fixture";

const summary = (endpoint: "pickup" | "dropoff" = "pickup") =>
  jsonMap(gpsFixture(endpoint)).summary;

test("same-query retries reject old dataset and render revisions", () => {
  const previous = initGps();
  const current = reloadGps(previous, "").model;
  for (const message of [
    M.LoadedGps({
      key: dataKey("", "pickup", previous.revision),
      data: summary(),
      error: "",
    }),
    M.GpsReady({
      key: frameKey("", "pickup", null, previous.revision),
      error: "",
    }),
  ])
    assert.equal(updateGps(current, message, { query: "" }).model, current);
});

test("stale endpoint, filter and render responses cannot replace the active GPS map", () => {
  const query = "from=2016-01-10";
  const model = { ...initGps(), endpoint: "dropoff" as const };
  for (const message of [
    M.LoadedGps({
      key: dataKey(query, "pickup"),
      data: summary(),
      error: "",
    }),
    M.LoadedGps({
      key: dataKey("", "dropoff"),
      data: summary("dropoff"),
      error: "",
    }),
    M.GpsReady({ key: dataKey(query, "pickup"), error: "Old renderer failed" }),
  ])
    assert.deepEqual(updateGps(model, message, { query }).model, model);
});

test("selection and Genie use the same GPS endpoint, counts and area without copying all geometry", () => {
  const activity = summary("dropoff");
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
      data: summary(),
      error: "",
    }),
  );
  assert.deepEqual(result.model, model);
  assert.equal(pageContext(result.model).page, "trips");
});
