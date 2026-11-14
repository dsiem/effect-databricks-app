import type { FeatureUpdate } from "../../lib/feature-update";

import type { Message } from "./messages";
import type { Model } from "./model";
export function updateOverview(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
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
