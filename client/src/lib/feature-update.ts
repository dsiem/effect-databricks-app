import type { Update } from "foldkit";
import type { ApiClient } from "./api-client";
import type { Idle } from "./idle";
// Feature outputs describe coordination requests; the application interprets them.
export type FeatureUpdate<
  Model,
  Message,
  Out = never,
> = Update.ReturnWithOutMessage<
  Model,
  Message | ReturnType<typeof Idle>,
  Out,
  ApiClient
>;
