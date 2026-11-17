import type { GpsCell, TripMap } from "../../../../shared/domain.js";
import {
  type MapCellSummary,
  type MapSummary,
  mapBudget,
  mapRetentionCharge,
} from "../../../../shared/map-dataset.js";

export const activityBucket = (trips: number, maximum: number) =>
  Math.min(4, Math.floor((trips / maximum) ** 0.32 * 5));

export interface MapResource {
  summary: MapSummary;
  rows: ReadonlyArray<GpsCell>;
  cell(index: number): MapCellSummary | undefined;
  index(id: string): number;
  ring(index: number): number[][];
  release(): void;
}
export const summarizeCell = ({
  boundary: _,
  ...cell
}: GpsCell): MapCellSummary => cell;
export function jsonMap(data: TripMap): MapResource {
  if (
    data.cells.length > mapBudget.rows ||
    mapRetentionCharge(
      new TextEncoder().encode(JSON.stringify(data)).byteLength,
      data.cells.length,
    ) > mapBudget.bytes
  )
    throw new Error("Map budget exceeded");
  let rows = data.cells;
  let indices = new Map(rows.map((cell, i) => [cell.id, i]));
  if (indices.size !== rows.length) throw new Error("Duplicate map cell");
  return {
    summary: {
      ...data,
      loaded: rows.length,
      cells: rows.slice(0, 5).map(summarizeCell),
    },
    get rows() {
      return rows;
    },
    cell: (index) => (rows[index] ? summarizeCell(rows[index]) : undefined),
    index: (id) => indices.get(id) ?? -1,
    ring: (index) => rows[index]?.boundary.coordinates[0] ?? [],
    release() {
      rows = [];
      indices = new Map();
    },
  };
}

export function pickedIndex(
  resource: MapResource,
  layerId: string,
  index: number,
) {
  return layerId === "gps-cells" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < resource.rows.length
    ? index
    : -1;
}
