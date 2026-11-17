import assert from "node:assert/strict";
import test from "node:test";
import { Popover } from "@foldkit/ui";
import type { SavedView, SavedViewsPage } from "../../shared/domain";
import { Message as M } from "../src/features/saved-views/messages";
import { init } from "../src/features/saved-views/model";
import {
  rememberRecent,
  visibleSavedViews,
} from "../src/features/saved-views/picker";
import { updateSavedViews as update } from "../src/features/saved-views/update";

const context = { filters: {} };
const row = (index: number): SavedView => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  title: `View ${index}`,
  body: "Finding",
  filters: { zip: "10001" },
  version: 1,
  pinned: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});
const opened = () =>
  update(
    init(),
    M.SavedViewsPicker({ message: Popover.Message.RequestedOpen() }),
    context,
  ).model;
const result = (
  version: number,
  rows: SavedView[],
  more = false,
  nextCursor: SavedViewsPage["nextCursor"] = null,
) =>
  M.LoadedSavedViews({
    version,
    data: { rows, nextCursor },
    error: "",
    more,
    pages: 1,
  });

test("a replaced search cannot start from an old cancellation or accept an old response", () => {
  const first = update(
    opened(),
    M.SavedViewSearchChanged({ value: "first" }),
    context,
  ).model;
  const latest = update(
    first,
    M.SavedViewSearchChanged({ value: "latest" }),
    context,
  ).model;
  const staleCancel = update(
    latest,
    M.CompletedCancelLoadSavedViews({
      version: first.searchVersion,
      more: false,
      debounce: true,
    }),
    context,
  );
  assert.equal(staleCancel.commands?.length, 0);
  const staleResponse = update(
    latest,
    result(first.searchVersion, [row(1)]),
    context,
  ).model;
  assert.deepEqual(visibleSavedViews(staleResponse), []);
  const current = update(
    staleResponse,
    result(latest.searchVersion, [row(2)]),
    context,
  ).model;
  assert.deepEqual(
    visibleSavedViews(current).map((entry) => entry.title),
    ["View 2"],
  );
});

test("closing and reopening cannot accept a previous session's search or shortcut hydration", () => {
  const first = update(
    opened(),
    M.SavedViewSearchChanged({ value: "first" }),
    context,
  ).model;
  const closed = update(
    first,
    M.SavedViewsPicker({ message: Popover.Message.RequestedClose() }),
    context,
  ).model;
  const reopened = update(
    closed,
    M.SavedViewsPicker({ message: Popover.Message.RequestedOpen() }),
    context,
  ).model;
  const late = update(
    reopened,
    result(first.searchVersion, [row(1)]),
    context,
  ).model;
  const hydrated = update(
    late,
    M.LoadedSavedViewShortcuts({
      version: first.shortcutVersion,
      data: { rows: [row(1)], recents: [row(1)] },
      recentIds: [row(1).id],
      error: "",
    }),
    context,
  ).model;
  assert.deepEqual(visibleSavedViews(hydrated), []);
  assert.deepEqual(hydrated.recentIds, []);
});

test("a failed continuation keeps results and its retry cursor, and a successful retry deduplicates IDs", () => {
  const searching = update(opened(), M.BrowseSavedViews(), context).model;
  const cursor = {
    id: row(1).id,
    pinned: false,
    updatedAt: "2026-01-01T00:00:00.000000Z",
  };
  const first = update(
    searching,
    result(searching.searchVersion, [row(1)], false, cursor),
    context,
  ).model;
  const pending = update(
    first,
    M.LoadSavedViews({ more: true }),
    context,
  ).model;
  const duplicate = update(pending, M.LoadSavedViews({ more: true }), context);
  assert.equal(duplicate.commands?.length, 0);
  const failed = update(
    pending,
    M.LoadedSavedViews({
      version: pending.searchVersion,
      data: null,
      error: "Try again",
      more: true,
      pages: 1,
    }),
    context,
  ).model;
  assert.deepEqual(
    visibleSavedViews(failed).map((entry) => entry.id),
    [row(1).id],
  );
  assert.deepEqual(failed.savedViews.data?.nextCursor, cursor);
  const retry = update(failed, M.LoadSavedViews({ more: true }), context).model;
  const loaded = update(
    retry,
    result(retry.searchVersion, [row(1), row(2)], true),
    context,
  ).model;
  assert.deepEqual(
    visibleSavedViews(loaded).map((entry) => entry.id),
    [row(1).id, row(2).id],
  );
});

test("applying a view promotes only its ID and invalidates pending recent hydration", () => {
  const model = opened();
  const applied = update(
    { ...model, recentIds: [row(1).id] },
    M.RestoreView({ savedView: row(2) }),
    context,
  );
  assert.deepEqual(applied.model.recentIds, [row(2).id, row(1).id]);
  assert.deepEqual(applied.outMessage, {
    _tag: "RestoreFilters",
    filters: row(2).filters,
  });
  const late = update(
    applied.model,
    M.LoadedSavedViewShortcuts({
      version: model.shortcutVersion,
      data: { rows: [row(1)], recents: [row(1)] },
      recentIds: [row(1).id],
      error: "",
    }),
    context,
  );
  assert.deepEqual(late.model.recentIds, [row(2).id, row(1).id]);
  assert.deepEqual(rememberRecent(["1", "2", "3", "4", "5"], "3"), [
    "3",
    "1",
    "2",
    "4",
    "5",
  ]);
});

test("shortcuts are bounded, deduplicate pinned recents, and stay unavailable until fresh hydration succeeds", () => {
  const pins = Array.from({ length: 6 }, (_, index) => ({
    ...row(index),
    pinned: true,
  }));
  const model = {
    ...opened(),
    recentIds: [row(0).id, row(30).id],
    shortcuts: {
      loading: false,
      error: "",
      data: { rows: pins, recents: [{ ...row(0), pinned: true }, row(30)] },
    },
  };
  assert.deepEqual(
    visibleSavedViews(model).map((entry) => entry.id),
    [...pins.slice(0, 5).map((entry) => entry.id), row(30).id],
  );
  assert.deepEqual(
    visibleSavedViews({
      ...model,
      shortcuts: { ...model.shortcuts, loading: true },
    }),
    [],
  );
  assert.deepEqual(
    visibleSavedViews({
      ...model,
      shortcuts: { ...model.shortcuts, error: "Unavailable" },
    }),
    [],
  );
});
