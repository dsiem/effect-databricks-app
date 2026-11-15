import { Tabs } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";
export const messages = {
  GpsTabs: { message: Tabs.Message },
  LoadedGps: {
    key: Schema.String,
    data: Schema.NullOr(D.GpsActivity),
    error: Schema.String,
  },
  GpsReady: { key: Schema.String, error: Schema.String },
  GpsSelect: { id: Schema.NullOr(Schema.String) },
};
export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
