import assert from "node:assert/strict";
import { test } from "node:test";
import { Option, Schema } from "effect";
import { Url } from "foldkit";
import { pageContext } from "../src/app/analysis-context";
import { Message as M } from "../src/app/message";
import { init, update } from "../src/app/update";
import { GridWindow } from "../src/features/trips/grid-protocol";

const initial = () =>
  init(Option.getOrThrow(Url.fromString("http://localhost/trips-preview")))
    .model;
const trip = {
  trip_id: "00000000-0000-4000-8000-000000000001",
  pickup_at: "2016-01-01 10:00:00.000000",
  dropoff_at: "2016-01-01 10:15:00.000000",
  pickup_zip: "10001",
  dropoff_zip: "10002",
  distance: 2,
  fare: 10,
  duration: 15,
};

test("grid status updates preserve the selected trip and open inspector", () => {
  const model = initial();
  const selected = update(
    model,
    M.TripGridSelected({ key: model.tripsState.gridKey, trip }),
  ).model;
  const scrolled = update(
    selected,
    M.TripGridStatus({
      key: model.tripsState.gridKey,
      loading: false,
      error: "",
      scope: "server-window",
      total: 2,
      loaded: 1,
    }),
  ).model;
  assert.equal(scrolled.tripsState.gridStatus.total, 2);
  assert.equal(scrolled.tripsState.gridStatus.loaded, 1);
  assert.deepEqual(scrolled.tripsState.selectedTrip, trip);
  assert.equal(scrolled.tripsState.inspectorDialog.isOpen, true);
});

test("query replacement rejects old grid counts and inspector requests", () => {
  const model = initial();
  const replaced = update(model, M.SortTrips({ sort: "fare" })).model;
  assert.notEqual(replaced.tripsState.gridKey, model.tripsState.gridKey);
  const status = update(
    replaced,
    M.TripGridStatus({
      key: model.tripsState.gridKey,
      loading: false,
      error: "",
      scope: "complete",
      total: 1,
      loaded: 1,
    }),
  ).model;
  assert.deepEqual(
    status.tripsState.gridStatus,
    replaced.tripsState.gridStatus,
  );
  assert.equal(
    update(status, M.TripGridSelected({ key: model.tripsState.gridKey, trip }))
      .model.tripsState.selectedTrip,
    null,
  );
});

test("preview context bounds its sample and clears obsolete scope on replacement", () => {
  let model = initial();
  const window = M.TripGridWindow({
    key: model.tripsState.gridKey,
    snapshot: "snapshot-7",
    start: 100,
    visible: 40,
    sample: [trip],
  });
  model = update(model, window).model;
  model = update(
    model,
    M.TripGridStatus({
      key: model.tripsState.gridKey,
      loading: false,
      error: "",
      scope: "server-window",
      total: 100000,
      loaded: 600,
    }),
  ).model;
  const data = JSON.parse(pageContext(model).data ?? "{}");
  assert.equal(pageContext(model).page, "trips");
  assert.equal(data.scope, "server-window");
  assert.equal(data.totalMatchingTrips, 100000);
  assert.equal(data.visibleStart, 100);
  assert.deepEqual(data.visibleSample, [trip]);
  assert.equal(model.tripsState.trips.data, null);
  assert.throws(() =>
    Schema.decodeUnknownSync(GridWindow)({
      ...window,
      sample: Array(6).fill(trip),
    }),
  );
  const replaced = update(model, M.SortTrips({ sort: "distance" })).model;
  assert.equal(replaced.tripsState.gridWindow, null);
  assert.equal(
    JSON.parse(pageContext(replaced).data ?? "{}").visibleSample,
    undefined,
  );
  assert.equal(update(replaced, window).model.tripsState.gridWindow, null);
});

test("sort URLs survive reload and history; saved views restore global scope with default sort", () => {
  const model = init(
    Option.getOrThrow(
      Url.fromString("http://localhost/trips-preview?zip=10001&sort=fare"),
    ),
  ).model;
  assert.equal(model.tripsState.sort, "fare");
  const sorted = update(model, M.SortTrips({ sort: "distance" }));
  assert.equal(sorted.model.query, "zip=10001&sort=distance");
  assert.ok(
    sorted.commands?.some(
      (command) =>
        command.args?.href === "/trips-preview?zip=10001&sort=distance",
    ),
  );
  const back = update(
    sorted.model,
    M.Navigated({ path: "/trips-preview", query: "zip=10001&sort=fare" }),
  ).model;
  assert.equal(back.tripsState.sort, "fare");
  const applied = update(back, M.ApplyFilters());
  assert.ok(
    applied.commands?.some(
      (command) => command.args?.href === "/trips-preview?zip=10001&sort=fare",
    ),
  );
  const restoring = update(
    back,
    M.RestoreView({
      savedView: {
        id: "00000000-0000-4000-8000-000000000003",
        title: "January pickups",
        body: "",
        filters: { from: "2016-01-01" },
        version: 1,
        pinned: false,
        created_at: "2026-11-16T10:00:00Z",
        updated_at: "2026-11-16T10:00:00Z",
      },
    }),
  );
  assert.ok(
    restoring.commands?.some(
      (command) => command.args?.href === "/trips-preview?from=2016-01-01",
    ),
  );
  const restored = update(
    back,
    M.Navigated({ path: "/trips-preview", query: "from=2016-01-01" }),
  ).model;
  assert.equal(restored.tripsState.sort, "newest");
  assert.equal(restored.filtersState.filterDraft.from, "2016-01-01");
  assert.equal(
    init(
      Option.getOrThrow(
        Url.fromString("http://localhost/trips-preview?sort=invalid"),
      ),
    ).model.tripsState.sort,
    "newest",
  );
});
