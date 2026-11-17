import { Effect, Option, Queue, Schedule, Schema, Stream } from "effect";
import { Subscription } from "foldkit";
import { loadStatus } from "../features/analysis-runs/commands";
import { Selection, watchedRun } from "../features/analysis-runs/model";
import { subscriptions as genieSubscriptions } from "../features/genie/subscription";
import type { ApiClient } from "../lib/api-client";
import { Message as M, type Message } from "./message";
import type { Model } from "./model";
import { systemThemeQuery } from "./theme";

const appSubscriptions = Subscription.make<Model, Message, ApiClient>()(
  (entry) => ({
    analysisRun: entry(
      { selection: Schema.NullOr(Selection) },
      {
        modelToDependencies: (model) => ({
          selection:
            model.location.route._tag === "AnalysisRuns"
              ? watchedRun(model.analysisRunsState)
              : null,
        }),
        dependenciesToStream: ({ selection }) =>
          selection
            ? Stream.fromEffectSchedule(
                loadStatus(selection),
                Schedule.spaced("3 seconds"),
              )
            : Stream.empty,
      },
    ),
    browser: entry(
      {},
      {
        modelToDependencies: () => ({}),
        dependenciesToStream: () =>
          Stream.callback<Message>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const keydown = (event: KeyboardEvent) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key.toLowerCase() === "b"
                  ) {
                    event.preventDefault();
                    Queue.offerUnsafe(queue, M.ToggleSidebar());
                  }
                };
                const media = matchMedia("(max-width: 767px)");
                const resize = () =>
                  Queue.offerUnsafe(
                    queue,
                    M.Resized({ mobile: media.matches }),
                  );
                const themeMedia = matchMedia(systemThemeQuery);
                const themeChanged = () =>
                  Queue.offerUnsafe(queue, M.SystemThemeChanged());
                window.addEventListener("keydown", keydown);
                media.addEventListener("change", resize);
                themeMedia.addEventListener("change", themeChanged);
                return () => {
                  window.removeEventListener("keydown", keydown);
                  media.removeEventListener("change", resize);
                  themeMedia.removeEventListener("change", themeChanged);
                };
              }),
              (cleanup) => Effect.sync(cleanup),
            ),
          ),
      },
    ),
  }),
);

export const subscriptions = Subscription.aggregate(
  appSubscriptions,
  Subscription.lift(genieSubscriptions)<Model, Message>({
    read: (model) => Option.some(model.genieState),
    toParentMessage: (message) => message,
  }),
);
