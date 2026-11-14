import assert from "node:assert/strict";
import { test } from "node:test";
import { Option } from "effect";
import { Url } from "foldkit";
import { Message as AppMessage } from "../src/app/message";
import { init, update } from "../src/app/update";
import { Message as FilterMessage } from "../src/features/filters/messages";
import * as Filters from "../src/features/filters/model";
import { updateFilters } from "../src/features/filters/update";
import { Message as GenieMessage } from "../src/features/genie/messages";
import * as Genie from "../src/features/genie/model";
import { updateGenie } from "../src/features/genie/update";
import { Message as OverviewMessage } from "../src/features/overview/messages";
import * as Overview from "../src/features/overview/model";
import { updateOverview } from "../src/features/overview/update";
import { Message as SavedMessage } from "../src/features/saved-views/messages";
import * as SavedViews from "../src/features/saved-views/model";
import { updateSavedViews } from "../src/features/saved-views/update";

const app = (path: string) =>
  init(Option.getOrThrow(Url.fromString(`http://localhost${path}`))).model;

test("overview accepts only the active response and requests selection invalidation", () => {
  const model = Overview.init();
  const stale = updateOverview(
    model,
    OverviewMessage.LoadedOverview({
      key: "old",
      data: null,
      error: "old failure",
    }),
    { requestKey: "current" },
  );
  assert.equal(stale.model, model);
  assert.equal(stale.outMessage, undefined);
  const current = updateOverview(
    model,
    OverviewMessage.LoadedOverview({
      key: "current",
      data: null,
      error: "Warehouse unavailable",
    }),
    { requestKey: "current" },
  );
  assert.equal(current.model.overview.error, "Warehouse unavailable");
  assert.deepEqual(current.outMessage, { _tag: "SelectionInvalidated" });
});

test("filters request navigation without owning routing state", () => {
  const changed = updateFilters(
    Filters.init(),
    FilterMessage.PickZip({ zip: "10001" }),
    { query: "from=2016-01-01" },
  );
  assert.deepEqual(changed.outMessage, {
    _tag: "Navigate",
    query: "from=2016-01-01&zip=10001",
  });
});

test("saved views capture supplied filters and emit restoration context", () => {
  const context = { filters: { zip: "10001" }, query: "zip=10001" };
  const created = updateSavedViews(
    SavedViews.init(),
    SavedMessage.CreatedNote({ id: "draft" }),
    context,
  );
  assert.deepEqual(created.model.editor?.draft.filters, context.filters);
  const restored = updateSavedViews(
    created.model,
    SavedMessage.RestoreView({ filters: { zip: "10019" } }),
    context,
  );
  assert.deepEqual(restored.outMessage, {
    _tag: "RestoreFilters",
    filters: { zip: "10019" },
  });
});

test("Genie retains the supplied analysis scope on the new turn", () => {
  const context = {
    filters: { zip: "10001" },
    context: { page: "trips" as const, title: "Visible records" },
    enabled: true,
  };
  const changed = updateGenie(
    Genie.init(),
    GenieMessage.CreatedTurn({ id: "turn", question: "Explain these fares" }),
    context,
  );
  assert.deepEqual(changed.model.turns[0]?.context, context.context);
  assert.deepEqual(changed.model.turns[0]?.filters, context.filters);
  assert.equal(changed.commands?.length, 2);
});

test("application coordinates trip paging and preserves unrelated feature state", () => {
  const model = app("/trips?zip=10001");
  const selected = {
    ...model,
    genieState: {
      ...model.genieState,
      genieSelection: { page: "trips" as const, title: "Old page" },
    },
  };
  const changed = update(selected, AppMessage.SetPage({ page: 2 }));
  assert.equal(changed.model.tripsState.page, 2);
  assert.equal(changed.model.tripsState.trips.loading, true);
  assert.equal(changed.model.genieState.genieSelection, null);
  assert.equal(changed.model.savedViewsState, model.savedViewsState);
  assert.equal(changed.commands?.[0]?.name, "LoadTrips");
});

test("application opens Genie, dismisses mobile navigation, and requests focus", () => {
  const model = { ...app("/trips"), mobileNavigation: true };
  const changed = update(
    model,
    AppMessage.OpenGenie({ context: null, question: null }),
  );
  assert.equal(changed.model.genieState.genieOpen, true);
  assert.equal(changed.model.mobileNavigation, false);
  assert.equal(changed.model.tripsState, model.tripsState);
  assert.ok(changed.commands?.some((command) => command.name === "Focus"));
});
