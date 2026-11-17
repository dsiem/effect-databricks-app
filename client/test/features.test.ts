import assert from "node:assert/strict";
import { test } from "node:test";
import { Dialog } from "@foldkit/ui";
import { Effect, Option } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { Url } from "foldkit";
import { given, message, model, story } from "foldkit/story";
import { AppApi } from "../../shared/api";
import { Message as AppMessage } from "../src/app/message";
import { init, update } from "../src/app/update";
import { exploreMessage } from "../src/app/view-messages";
import { Message as FilterMessage } from "../src/features/filters/messages";
import * as Filters from "../src/features/filters/model";
import { updateFilters } from "../src/features/filters/update";
import { Message as GenieMessage } from "../src/features/genie/messages";
import * as Genie from "../src/features/genie/model";
import { presentGenie, updateGenie } from "../src/features/genie/update";
import { Message as OverviewMessage } from "../src/features/overview/messages";
import * as Overview from "../src/features/overview/model";
import { updateOverview } from "../src/features/overview/update";
import { Message as OverviewViewMessage } from "../src/features/overview/view-messages";
import { Message as SavedMessage } from "../src/features/saved-views/messages";
import * as SavedViews from "../src/features/saved-views/model";
import { updateSavedViews } from "../src/features/saved-views/update";
import { Message as TripMessage } from "../src/features/trips/messages";
import * as Trips from "../src/features/trips/model";
import { updateTrips } from "../src/features/trips/update";
import { ApiClient } from "../src/lib/api-client";

const app = (path: string) =>
  init(Option.getOrThrow(Url.fromString(`http://localhost${path}`))).model;

const trip = {
  trip_id: "trip-1",
  pickup_at: "2016-01-01 10:00:00",
  dropoff_at: "2016-01-01 10:15:00",
  pickup_zip: "10001",
  dropoff_zip: "10019",
  distance: 2,
  fare: 12,
  duration: 15,
  details: {
    source_file: "test.csv",
    vendor_id: null,
    passenger_count: null,
    rate_code_id: null,
    store_and_fwd_flag: null,
    payment_type: null,
    pickup_location: null,
    dropoff_location: null,
    tip_amount: null,
    tolls_amount: null,
    extra: null,
    mta_tax: null,
    improvement_surcharge: null,
    total_amount: null,
  },
};

test("view intents are translated by the shell with their analysis scope intact", () => {
  const context = {
    page: "overview" as const,
    title: "Trips by pickup date",
    data: "[]",
  };
  const changed = update(
    app("/"),
    exploreMessage(
      OverviewViewMessage.Analyze({ context, question: "Explain these fares" }),
    ),
  );
  assert.equal(changed.model.genieState.genieOpen, true);
  assert.deepEqual(changed.model.genieState.genieSelection, context);
  assert.equal(changed.model.genieState.genieDraft, "Explain these fares");
  const picked = update(app("/trip-map"), AppMessage.PickZip({ zip: "10019" }));
  assert.ok(
    picked.commands?.some(
      (command) => command.args?.href === "/trip-map?zip=10019",
    ),
  );
  const navigated = update(
    picked.model,
    AppMessage.Navigated({ path: "/trip-map", query: "zip=10019" }),
  );
  assert.equal(navigated.model.filtersState.filterDraft.zip, "10019");
});

test("returning to a filter keeps fresh trip results when the original load fails", async () => {
  const opened = init(
    Option.getOrThrow(Url.fromString("http://localhost/trips?zip=10001")),
  );
  const visit = (zip: string) =>
    AppMessage.Navigated({ path: "/trips", query: `zip=${zip}` });
  const changed = update(opened.model, visit("10002"));
  const returned = update(changed.model, visit("10001"));
  const respond = (load: ReturnType<typeof init>, response: Response) => {
    const command = load.commands?.find(({ name }) => name === "LoadTrips");
    assert.ok(command);
    return Effect.runPromise(
      command.effect.pipe(
        Effect.provideServiceEffect(
          ApiClient,
          Effect.gen(function* () {
            const httpClient = HttpClient.withScope(
              yield* HttpClient.HttpClient,
            );
            return (yield* HttpApiClient.makeWith(AppApi, {
              httpClient,
              baseUrl: "http://fixture.test",
            })).app;
          }).pipe(Effect.provide(FetchHttpClient.layer)),
        ),
        Effect.provideService(FetchHttpClient.Fetch, async () => response),
      ),
    );
  };
  const data = { rows: [], total: 0, page: 1, pageSize: 25 };
  const fresh = await respond(returned, Response.json(data));
  const stale = await respond(
    opened,
    Response.json(
      {
        error: {
          code: "workspace_timeout",
          message: "Original load timed out",
        },
      },
      { status: 504 },
    ),
  );
  story(
    update,
    given(returned.model),
    message(fresh),
    message(stale),
    model(({ tripsState }) => {
      assert.equal(tripsState.trips.error, "");
      assert.deepEqual(tripsState.trips.data, data);
    }),
  );
});

test("a standalone trip feature closes its inspector and ignores late comments", () => {
  const opened = updateTrips(Trips.init(), TripMessage.InspectTrip({ trip }));
  assert.equal(opened.model.inspectorDialog.isOpen, true);
  const closed = updateTrips(
    opened.model,
    TripMessage.InspectorDialog({ message: Dialog.Message.RequestedClose() }),
  );
  assert.equal(closed.model.selectedTrip, null);
  assert.equal(closed.model.inspectorDialog.isOpen, false);
  assert.ok(closed.commands?.some((command) => command.name === "CloseDialog"));
  const late = updateTrips(
    closed.model,
    TripMessage.LoadedComments({
      tripId: trip.trip_id,
      data: { rows: [], nextCursor: null },
      error: "",
      more: false,
    }),
  );
  assert.equal(late.model.selectedTrip, null);
  assert.equal(late.model.inspectorDialog.isOpen, false);
});

test("navigation retains the trip feature's dialog cleanup commands", () => {
  const opened = update(app("/trips"), AppMessage.InspectTrip({ trip }));
  const navigated = update(
    opened.model,
    AppMessage.Navigated({ path: "/", query: "" }),
  );
  assert.equal(navigated.model.tripsState.selectedTrip, null);
  assert.equal(navigated.model.tripsState.inspectorDialog.isOpen, false);
  assert.ok(
    navigated.commands?.some((command) => command.name === "CloseDialog"),
  );
});

test("sort URLs survive reload and history; saved views restore global scope with default sort", () => {
  const open = (path: string) =>
    init(Option.getOrThrow(Url.fromString(`http://localhost${path}`)));
  const tripLoad = (result: ReturnType<typeof init>) =>
    result.commands?.find(({ name }) => name === "LoadTrips")?.args;
  const opened = open("/trips?zip=10001&sort=fare");
  assert.equal(tripLoad(opened)?.sort, "fare");
  const sorted = update(
    opened.model,
    AppMessage.SortTrips({ sort: "distance" }),
  );
  assert.equal(tripLoad(sorted)?.sort, "distance");
  assert.ok(
    sorted.commands?.some(
      (command) => command.args?.href === "/trips?zip=10001&sort=distance",
    ),
  );
  const arrived = update(
    sorted.model,
    AppMessage.Navigated({ path: "/trips", query: "zip=10001&sort=distance" }),
  );
  assert.equal(tripLoad(arrived), undefined);
  const back = update(
    sorted.model,
    AppMessage.Navigated({ path: "/trips", query: "zip=10001&sort=fare" }),
  );
  assert.equal(tripLoad(back)?.sort, "fare");
  const applied = update(back.model, AppMessage.ApplyFilters());
  assert.ok(
    applied.commands?.some(
      (command) => command.args?.href === "/trips?zip=10001&sort=fare",
    ),
  );
  const restoring = update(
    back.model,
    AppMessage.RestoreView({
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
      (command) => command.args?.href === "/trips?from=2016-01-01",
    ),
  );
  const restored = update(
    back.model,
    AppMessage.Navigated({ path: "/trips", query: "from=2016-01-01" }),
  );
  assert.equal(tripLoad(restored)?.sort, "newest");
  assert.equal(restored.model.filtersState.filterDraft.from, "2016-01-01");
  assert.equal(tripLoad(open("/trips?sort=invalid"))?.sort, "newest");
  const repeated = tripLoad(
    open("/trips?zip=10002&sort=fare&zip=10001&sort=distance"),
  );
  assert.equal(repeated?.sort, "fare");
  assert.deepEqual(repeated?.filters, { zip: "10001" });
});

test("comment counts from an older trip page cannot replace the current rows' counts", () => {
  const loaded = (model: Trips.Model) =>
    updateTrips(
      model,
      TripMessage.LoadedTrips({
        generation: model.loadGeneration,
        error: "",
        data: { rows: [trip], total: 1, page: 1, pageSize: 25 },
      }),
    ).model;
  const firstPage = loaded(Trips.init());
  const nextPage = loaded(firstPage);
  const current = updateTrips(
    nextPage,
    TripMessage.LoadedCommentCounts({
      version: nextPage.commentCountsVersion,
      data: { [trip.trip_id]: 3 },
      error: "",
    }),
  ).model;
  const late = updateTrips(
    current,
    TripMessage.LoadedCommentCounts({
      version: firstPage.commentCountsVersion,
      data: { [trip.trip_id]: 0 },
      error: "",
    }),
  ).model;
  assert.equal(late.commentCounts.data?.[trip.trip_id], 3);
});

test("saved views own editor dismissal and prevent closing an in-flight save", () => {
  const context = { filters: {} };
  const created = updateSavedViews(
    SavedViews.init(),
    SavedMessage.CreatedSavedView({ id: "draft" }),
    context,
  );
  assert.equal(created.model.dialogs.savedView.isOpen, true);
  const named = updateSavedViews(
    created.model,
    SavedMessage.SavedViewChanged({ field: "title", value: "My view" }),
    context,
  );
  const saving = updateSavedViews(
    named.model,
    SavedMessage.SaveSavedView(),
    context,
  );
  for (const message of [
    SavedMessage.CloseSavedView(),
    SavedMessage.SavedViewDialog({ message: Dialog.Message.RequestedClose() }),
  ]) {
    const blocked = updateSavedViews(saving.model, message, context);
    assert.equal(blocked.model.editor?.saving, true);
    assert.equal(blocked.model.dialogs.savedView.isOpen, true);
  }
  const failed = updateSavedViews(
    saving.model,
    SavedMessage.SavedViewSaved({ savedView: null, error: "Try again" }),
    context,
  );
  const closed = updateSavedViews(
    failed.model,
    SavedMessage.CloseSavedView(),
    context,
  );
  assert.equal(closed.model.editor, null);
  assert.equal(closed.model.dialogs.savedView.isOpen, false);
});

test("saved views keep deletion open during a write and close it after success", () => {
  const context = { filters: {} };
  const savedView = {
    id: "8aa0cc1a-6033-4fd0-9a61-908958570382",
    title: "View",
    body: "",
    filters: {},
    version: 1,
    pinned: false,
    created_at: "",
    updated_at: "",
  };
  const opened = updateSavedViews(
    SavedViews.init(),
    SavedMessage.DeleteSavedView({ savedView }),
    context,
  );
  assert.equal(opened.model.dialogs.delete.isOpen, true);
  const busy = updateSavedViews(
    opened.model,
    SavedMessage.ConfirmDelete(),
    context,
  );
  for (const message of [
    SavedMessage.CloseDelete(),
    SavedMessage.DeleteDialog({ message: Dialog.Message.RequestedClose() }),
  ]) {
    const blocked = updateSavedViews(busy.model, message, context);
    assert.equal(blocked.model.deleting?.id, savedView.id);
    assert.equal(blocked.model.dialogs.delete.isOpen, true);
  }
  const deleted = updateSavedViews(
    busy.model,
    SavedMessage.MutatedSavedView({ removed: true, error: "" }),
    context,
  );
  assert.equal(deleted.model.deleting, null);
  assert.equal(deleted.model.dialogs.delete.isOpen, false);
});

test("Genie owns its modal presentation without discarding the conversation on resize", () => {
  const context = {
    filters: {},
    context: { page: "trips" as const, title: "Trips" },
    enabled: true,
  };
  const opened = updateGenie(
    Genie.init(),
    GenieMessage.OpenGenie({ context: null, question: "Explain" }),
    context,
  );
  const mobile = presentGenie(opened.model, true);
  assert.equal(mobile.model.helperDialog.isOpen, true);
  const desktop = presentGenie(mobile.model, false);
  assert.equal(desktop.model.helperDialog.isOpen, false);
  assert.equal(desktop.model.genieOpen, true);
  assert.equal(desktop.model.genieDraft, "Explain");
  const remounted = presentGenie(desktop.model, true);
  const closed = updateGenie(
    remounted.model,
    GenieMessage.GenieDialog({ message: Dialog.Message.RequestedClose() }),
    context,
  );
  assert.equal(closed.model.genieOpen, false);
  assert.equal(closed.model.helperDialog.isOpen, false);
});

test("Genie resumes restored reads without replaying conversation submissions", () => {
  const context = {
    filters: {},
    context: { page: "genie" as const, title: "Analysis" },
    enabled: true,
  };
  const operation = { conversationId: "conversation", messageId: "message" };
  const restored = updateGenie(
    Genie.init(),
    GenieMessage.RestoredConversation({
      turns: [
        { id: "waiting", question: "First", state: "waiting", operation },
        {
          id: "retrieving",
          question: "Second",
          state: "retrieving",
          operation,
        },
        {
          id: "unknown",
          question: "Third",
          state: "submission-unknown",
          error: "Response lost",
        },
      ],
      persistenceError: "",
    }),
    context,
  );
  assert.equal(restored.model.turns.length, 3);
  assert.deepEqual(
    restored.commands?.map((command) => command.name),
    ["RetrieveQuestion"],
  );
});

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

test("paging trips clears analysis of the previous page", () => {
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
});

test("application opens Genie, dismisses mobile navigation, and requests focus", () => {
  const model = { ...app("/trips"), mobileNavigation: true };
  const changed = update(
    model,
    AppMessage.OpenGenie({ context: null, question: null }),
  );
  assert.equal(changed.model.genieState.genieOpen, true);
  assert.equal(changed.model.mobileNavigation, false);
  assert.ok(changed.commands?.some((command) => command.name === "Focus"));
});

test("invalid draft filters report an error without requesting navigation", () => {
  const result = updateFilters(
    {
      ...Filters.init(),
      filterDraft: { from: "2016-02-20", to: "2016-01-10", zip: "" },
      error: "",
    },
    FilterMessage.ApplyFilters(),
    { filters: { zip: "10001" }, metadata: null },
  );
  assert.equal(result.outMessage, undefined);
  assert.match(result.model.error, /start date must be on or before/);
});
