import { Tabs } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { empty, request } from "../../lib/request-state";
export const Model = Schema.Struct({
  endpoint: D.GpsEndpoint,
  endpointTabs: Tabs.Model,
  activity: request(D.TripMap),
  selected: Schema.NullOr(Schema.String),
  renderedKey: Schema.String,
  mapError: Schema.String,
});
export type Model = typeof Model.Type;
export const dataKey = (query: string, endpoint: D.GpsEndpoint) =>
  `${query}#${endpoint}`;
export const frameKey = (
  query: string,
  endpoint: D.GpsEndpoint,
  selected: string | null,
) => JSON.stringify([query, endpoint, selected]);
export const init = (): Model => ({
  endpoint: "pickup",
  endpointTabs: Tabs.init({ id: "gps-endpoint" }),
  activity: empty,
  selected: null,
  renderedKey: "",
  mapError: "",
});
