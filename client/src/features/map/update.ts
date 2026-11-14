import type { Update } from "foldkit";
import type { Message } from "../../app/message";
import type { Model } from "../../app/model";
import type { ApiClient } from "../../lib/api-client";
export function updateMap(
  model: Model,
  message: Extract<Message, { readonly _tag: "MapReady" }>,
): Update.Return<Model, Message, ApiClient> {
  switch (message._tag) {
    case "MapReady":
      return model.query !== message.query
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
