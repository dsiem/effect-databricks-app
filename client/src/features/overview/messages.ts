import { Tabs } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import * as D from "../../../../shared/domain";

export const messages = {
  MetricTabs: { message: Tabs.Message },
  LoadedOverview: {
    key: Schema.String,
    data: Schema.NullOr(D.Overview),
    error: Schema.String,
  },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
