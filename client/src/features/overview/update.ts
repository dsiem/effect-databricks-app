import { Command } from "foldkit";
import type { FeatureUpdate } from "../../lib/feature-update";

import { Message as M, type Message } from "./messages";
import { MetricTabs } from "./metric-tabs";
import type { Model } from "./model";
export function updateOverview(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "MetricTabs": {
      const changed = MetricTabs.update(model.metricTabs, message.message);
      return {
        model: {
          ...model,
          metricTabs: changed.model,
          series: changed.outMessage?.value ?? model.series,
        },
        commands: (changed.commands ?? []).map((command) =>
          Command.mapMessage(command, (message) => M.MetricTabs({ message })),
        ),
        ...(changed.outMessage
          ? { outMessage: { _tag: "SelectionInvalidated" as const } }
          : {}),
      };
    }
    case "LoadedOverview":
      return message.key !== context.requestKey
        ? { model }
        : {
            outMessage: { _tag: "SelectionInvalidated" },
            model: {
              ...model,
              overview: {
                data: message.data,
                error: message.error,
                loading: false,
              },
            },
          };
  }
}

export type Context = { readonly requestKey: string };
export type Out = { readonly _tag: "SelectionInvalidated" };
