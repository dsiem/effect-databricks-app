import { Tabs } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";

import { request } from "../../lib/request-state";
export const fields = {
  metricTabs: Tabs.Model,
  overview: request(D.Overview),
  series: Schema.Literals(["trips", "revenue"]),
};
