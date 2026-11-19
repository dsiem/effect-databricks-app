import { Tabs } from "@foldkit/ui";
import { Schema } from "effect";
import * as D from "../../../../shared/domain";
import { MapCellSummary, MapSummary } from "../../../../shared/map-dataset";
import { empty, Notice, request } from "../../lib/request-state";
export const Model = Schema.Struct({
  endpoint: D.GpsEndpoint,
  endpointTabs: Tabs.Model,
  activity: request(MapSummary),
  revision: Schema.Int,
  selected: Schema.NullOr(Schema.String),
  selectedCell: Schema.NullOr(MapCellSummary),
  renderedKey: Schema.String,
  mapError: Notice,
});
export type Model = typeof Model.Type;
export const endpointName = (endpoint: D.GpsEndpoint) =>
  endpoint === "pickup" ? "pickups" : "drop-offs";
export const dataKey = (query: string, endpoint: D.GpsEndpoint, revision = 0) =>
  JSON.stringify([query, endpoint, revision]);
export const frameKey = (
  query: string,
  endpoint: D.GpsEndpoint,
  selected: string | null,
  revision = 0,
) => JSON.stringify([query, endpoint, selected, revision]);
export const init = (): Model => ({
  endpoint: "pickup",
  endpointTabs: Tabs.init({ id: "gps-endpoint" }),
  activity: empty,
  revision: 0,
  selected: null,
  selectedCell: null,
  renderedKey: "",
  mapError: "",
});
