import { Schema, Struct } from "effect";
import { GpsCell, TripMap } from "./domain.js";

export const MapCellSummary = GpsCell.mapFields(Struct.omit(["boundary"]));
export type MapCellSummary = typeof MapCellSummary.Type;
export const MapSummary = Schema.Struct({
  ...Struct.omit(TripMap.fields, ["cells"]),
  loaded: Schema.Int,
  cells: Schema.Array(MapCellSummary).check(Schema.isMaxLength(5)),
});
export type MapSummary = typeof MapSummary.Type;
