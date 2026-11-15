import type { Trip } from "../../../../shared/domain";

export function tripCsv(trips: ReadonlyArray<Trip>) {
  const fields = [
    "trip_id",
    "pickup_at",
    "dropoff_at",
    "pickup_zip",
    "dropoff_zip",
    "distance",
    "fare",
    "duration",
    "source_file",
    "vendor_id",
    "passenger_count",
    "rate_code_id",
    "store_and_fwd_flag",
    "payment_type",
    "pickup_longitude",
    "pickup_latitude",
    "dropoff_longitude",
    "dropoff_latitude",
    "tip_amount",
    "tolls_amount",
    "extra",
    "mta_tax",
    "improvement_surcharge",
    "total_amount",
  ] as const;
  const rows = trips.map(({ details, ...trip }) => ({
    ...trip,
    ...details,
    pickup_longitude: details?.pickup_location?.longitude,
    pickup_latitude: details?.pickup_location?.latitude,
    dropoff_longitude: details?.dropoff_location?.longitude,
    dropoff_latitude: details?.dropoff_location?.latitude,
  }));
  return [
    fields.join(","),
    ...rows.map((row) =>
      fields
        .map((field) => `"${String(row[field] ?? "").replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\r\n");
}
