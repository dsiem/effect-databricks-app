import type { FeatureUpdate } from "../../lib/feature-update";

import type { Message } from "./messages";
import type { Model } from "./model";
export function updateMap(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "MapReady":
      return context.query !== message.query
        ? { model }
        : {
            model: {
              ...model,
              mappedTrips: message.mapped,
              mapError: message.error,
            },
          };
  }
}

export type Context = { readonly query: string };
export type Out = never;
