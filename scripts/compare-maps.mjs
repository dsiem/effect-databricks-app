import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

// Export a real, fixed comparison cohort. Credentials stay inside the CLI.
const table = process.env.TRIP_SNAPSHOT_TABLE;
if (
  !table ||
  !/^(?:[A-Za-z_][A-Za-z0-9_-]*\.){2}[A-Za-z_][A-Za-z0-9_-]*$/.test(table)
)
  throw new Error("Load .env with a valid TRIP_SNAPSHOT_TABLE");
const source = table
  .split(".")
  .map((part) => `\`${part}\``)
  .join(".");
const cli = (method, path, body) =>
  JSON.parse(
    execFileSync(
      "databricks",
      [
        "api",
        method,
        path,
        "-o",
        "json",
        ...(body ? ["--json", JSON.stringify(body)] : []),
      ],
      { encoding: "utf8", maxBuffer: 24 * 1024 * 1024 },
    ),
  );
async function query(statement) {
  let result = cli("post", "/api/2.0/sql/statements", {
    warehouse_id: process.env.DATABRICKS_WAREHOUSE_ID,
    statement,
    wait_timeout: "10s",
    on_wait_timeout: "CONTINUE",
    row_limit: 30000,
  });
  const deadline = Date.now() + 180000;
  while (["PENDING", "RUNNING"].includes(result.status.state)) {
    if (Date.now() > deadline) {
      cli("post", `/api/2.0/sql/statements/${result.statement_id}/cancel`);
      throw new Error("Map export timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = cli("get", `/api/2.0/sql/statements/${result.statement_id}`);
  }
  if (result.status.state !== "SUCCEEDED" || result.manifest.truncated)
    throw new Error(JSON.stringify(result.status));
  const rows = result.result?.data_array ?? [];
  let next = result.result?.next_chunk_internal_link;
  while (next) {
    const chunk = cli("get", next);
    rows.push(...chunk.data_array);
    next = chunk.next_chunk_internal_link;
  }
  const columns = result.manifest.schema.columns;
  return rows.map((row) =>
    Object.fromEntries(
      columns.map((column, index) => [
        column.name,
        row[index] === null
          ? null
          : ["DOUBLE", "LONG", "INT"].includes(column.type_name)
            ? Number(row[index])
            : row[index],
      ]),
    ),
  );
}
const metadata = (
  await query(`SELECT COUNT(*)::DOUBLE AS trips,
  count_if(pickup_coordinates_valid)::DOUBLE AS pickups,
  count_if(dropoff_coordinates_valid)::DOUBLE AS dropoffs
  FROM ${source}`)
)[0];
console.log("Exporting GPS points");
const points =
  await query(`SELECT pickup_longitude AS longitude, pickup_latitude AS latitude,
  fare_amount AS fare, trip_distance AS distance FROM ${source}
  WHERE pickup_coordinates_valid AND pmod(xxhash64(trip_id), 2048) = 0 LIMIT 15000`);
console.log("Exporting full density aggregates");
const density = await query(`WITH counts AS (
  SELECT h3_longlatash3(pickup_longitude, pickup_latitude, 8) AS cell,
    COUNT(*)::DOUBLE AS trips, AVG(fare_amount) AS fare FROM ${source}
  WHERE pickup_coordinates_valid GROUP BY 1
) SELECT h3_h3tostring(cell) AS cell, trips, fare,
  h3_boundaryasgeojson(cell) AS geometry, h3_centerasgeojson(cell) AS center FROM counts`);
console.log("Exporting busiest origin-destination connections");
const flows = await query(`WITH pairs AS (
  SELECT h3_longlatash3(pickup_longitude, pickup_latitude, 7) AS origin,
    h3_longlatash3(dropoff_longitude, dropoff_latitude, 7) AS destination,
    COUNT(*)::DOUBLE AS trips FROM ${source}
  WHERE pickup_coordinates_valid AND dropoff_coordinates_valid
  GROUP BY 1,2 HAVING origin <> destination
) SELECT trips, h3_centerasgeojson(origin) AS origin,
  h3_centerasgeojson(destination) AS destination FROM pairs ORDER BY trips DESC LIMIT 80`);
for (const cell of density) {
  cell.polygon = JSON.parse(cell.geometry).coordinates[0];
  cell.center = JSON.parse(cell.center).coordinates;
  delete cell.geometry;
}
for (const flow of flows) {
  flow.origin = JSON.parse(flow.origin).coordinates;
  flow.destination = JSON.parse(flow.destination).coordinates;
}
const data = {
  checkedAt: new Date().toISOString(),
  source: table,
  metadata,
  points,
  density,
  flows,
};
mkdirSync(".databricks/map-prototypes", { recursive: true });
writeFileSync(".databricks/map-prototypes/data.json", JSON.stringify(data));
console.log(
  JSON.stringify({
    points: points.length,
    cells: density.length,
    flows: flows.length,
    ...metadata,
  }),
);
