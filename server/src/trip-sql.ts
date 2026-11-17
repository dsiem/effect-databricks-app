import type { DatabricksClient } from "effect-sql-databricks";

export const tripDetailsProjection = (sql: DatabricksClient.DatabricksClient) =>
  sql`to_json(named_struct(
            'source_file', source_file, 'vendor_id', VendorID,
            'passenger_count', passenger_count, 'rate_code_id', RatecodeID,
            'store_and_fwd_flag', store_and_fwd_flag, 'payment_type', payment_type,
            'pickup_location', CASE WHEN pickup_coordinates_valid THEN named_struct('longitude', pickup_longitude, 'latitude', pickup_latitude) END,
            'dropoff_location', CASE WHEN dropoff_coordinates_valid THEN named_struct('longitude', dropoff_longitude, 'latitude', dropoff_latitude) END,
            'tip_amount', CASE WHEN abs(tip_amount) < double('Infinity') THEN tip_amount END,
            'tolls_amount', CASE WHEN abs(tolls_amount) < double('Infinity') THEN tolls_amount END,
            'extra', CASE WHEN abs(extra) < double('Infinity') THEN extra END,
            'mta_tax', CASE WHEN abs(mta_tax) < double('Infinity') THEN mta_tax END,
            'improvement_surcharge', CASE WHEN abs(improvement_surcharge) < double('Infinity') THEN improvement_surcharge END,
            'total_amount', CASE WHEN abs(total_amount) < double('Infinity') THEN total_amount END
          ), map('ignoreNullFields', 'false')) AS details`;
