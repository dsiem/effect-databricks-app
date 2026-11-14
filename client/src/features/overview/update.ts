import type { Update } from "foldkit";
import type { Message } from "../../app/message";
import { type Model, requestKey } from "../../app/model";
import type { ApiClient } from "../../lib/api-client";
export function updateOverview(
  model: Model,
  message: Extract<Message, { readonly _tag: "LoadedOverview" }>,
): Update.Return<Model, Message, ApiClient> {
  switch (message._tag) {
    case "LoadedOverview":
      return message.key !== requestKey(model)
        ? { model }
        : {
            model: {
              ...model,
              overview: {
                data: message.data,
                error: message.error,
                loading: false,
              },
              genieSelection: null,
            },
          };
  }
}
