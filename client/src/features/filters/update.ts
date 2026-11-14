import type { FeatureUpdate } from "../../lib/feature-update";
import type { Message } from "./messages";
import type { Model } from "./model";
import { filtersFromQuery, queryFor } from "./query";
export function updateFilters(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "FilterChanged":
      return {
        model: {
          ...model,
          filterDraft: { ...model.filterDraft, [message.field]: message.value },
        },
      };
    case "ApplyFilters":
      return {
        model,
        outMessage: { _tag: "Navigate", query: queryFor(model.filterDraft) },
      };
    case "ResetFilters":
      return { model, outMessage: { _tag: "Navigate", query: "" } };
    case "PickZip":
      return {
        model,
        outMessage: {
          _tag: "Navigate",
          query: queryFor({
            ...(filtersFromQuery(context.query) ?? {}),
            zip: message.zip,
          }),
        },
      };
  }
}

export type Context = {
  readonly query: string;
};
export type Out = { readonly _tag: "Navigate"; readonly query: string };
