import { Tabs } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
export const Model = Schema.Struct({
  metricTabs: Tabs.Model,
  overview: request(D.Overview),
  series: Schema.Literals(["trips", "revenue"]),
});

export type Model = typeof Model.Type;

export const init = (): Model => ({
  metricTabs: Tabs.init({ id: "daily-metric" }),
  overview: empty,
  series: "trips",
});
