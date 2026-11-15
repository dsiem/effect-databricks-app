import assert from "node:assert/strict";
import { test } from "node:test";
import { tripCsv } from "../src/features/trips/export.js";

test("trip CSV includes recorded endpoints and itemized charges, preserving zero and unknown values", () => {
  const csv = tripCsv([
    {
      trip_id: "trip-1",
      pickup_at: "2016-01-02 10:00:00",
      dropoff_at: "2016-01-02 10:10:00",
      pickup_zip: "10001",
      dropoff_zip: "Unknown",
      distance: 2,
      fare: 10,
      duration: 10,
      details: {
        source_file: 'source,"January".csv.gz',
        vendor_id: 2,
        passenger_count: 0,
        rate_code_id: 1,
        store_and_fwd_flag: "N",
        payment_type: 2,
        pickup_location: { longitude: -73.99, latitude: 40.75 },
        dropoff_location: null,
        tip_amount: 0,
        tolls_amount: 0,
        extra: 0.5,
        mta_tax: 0.5,
        improvement_surcharge: 0.3,
        total_amount: 11.3,
      },
    },
  ]);
  assert.match(
    csv,
    /pickup_longitude,pickup_latitude,dropoff_longitude,dropoff_latitude/,
  );
  assert.match(
    csv,
    /"source,""January"".csv.gz","2","0","1","N","2","-73.99","40.75","","","0","0","0.5","0.5","0.3","11.3"/,
  );
});
