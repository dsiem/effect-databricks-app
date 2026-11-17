import { Schedule, Schema, Stream } from "effect";
import { Subscription } from "foldkit";
import type { ApiClient } from "../../lib/api-client";
import { loadStatus } from "./commands";
import type { Message } from "./messages";
import { type Model, Selection, watchedRun } from "./model";

export const subscriptions = Subscription.make<Model, Message, ApiClient>()(
  (entry) => ({
    analysisRun: entry(
      { selection: Schema.NullOr(Selection) },
      {
        modelToDependencies: (model) => ({ selection: watchedRun(model) }),
        dependenciesToStream: ({ selection }) =>
          selection
            ? Stream.fromEffectSchedule(
                loadStatus(selection),
                Schedule.spaced("3 seconds"),
              )
            : Stream.empty,
      },
    ),
  }),
);
