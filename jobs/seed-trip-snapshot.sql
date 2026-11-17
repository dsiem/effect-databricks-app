-- Databricks notebook source
-- January and February 2016 taxi snapshot.
SELECT assert_true(
  :catalog RLIKE '^[A-Za-z_][A-Za-z0-9_-]{0,127}$'
    AND :schema RLIKE '^[A-Za-z_][A-Za-z0-9_-]{0,127}$'
    AND :app_service_principal_id RLIKE '(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'Expected valid catalog/schema identifiers and the Databricks App principal UUID.'
);

-- COMMAND ----------

-- Explicit schema avoids CSV inference and preserves all 19 source fields.
-- Persisted UUIDs distinguish even identical source rows across reruns.
CREATE TABLE IF NOT EXISTS IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016_raw`')
USING DELTA AS
SELECT uuid() AS trip_id, _metadata.file_name AS source_file, source.*,
  coalesce(tpep_pickup_datetime >= TIMESTAMP_NTZ'2016-01-01'
    AND tpep_pickup_datetime < TIMESTAMP_NTZ'2016-03-01'
    AND tpep_dropoff_datetime > tpep_pickup_datetime
    AND tpep_dropoff_datetime <= tpep_pickup_datetime + INTERVAL 1 DAY
    AND trip_distance > 0 AND trip_distance < double('Infinity')
    AND fare_amount > 0 AND fare_amount < double('Infinity'), false) AS analytics_valid,
  coalesce(pickup_longitude BETWEEN -75 AND -72 AND pickup_latitude BETWEEN 40 AND 42, false) AS pickup_coordinates_valid,
  coalesce(dropoff_longitude BETWEEN -75 AND -72 AND dropoff_latitude BETWEEN 40 AND 42, false) AS dropoff_coordinates_valid
FROM read_files(
  '/Volumes/samples/databricks/datasets/nyctaxi/tripdata/yellow/yellow_tripdata_2016-0[12].csv.gz',
  format => 'csv', header => true, mode => 'FAILFAST',
  schema => 'VendorID INT, tpep_pickup_datetime TIMESTAMP_NTZ, tpep_dropoff_datetime TIMESTAMP_NTZ, passenger_count INT, trip_distance DOUBLE, pickup_longitude DOUBLE, pickup_latitude DOUBLE, RatecodeID INT, store_and_fwd_flag STRING, dropoff_longitude DOUBLE, dropoff_latitude DOUBLE, payment_type INT, fare_amount DOUBLE, extra DOUBLE, mta_tax DOUBLE, tip_amount DOUBLE, tolls_amount DOUBLE, improvement_surcharge DOUBLE, total_amount DOUBLE'
) AS source;

-- COMMAND ----------

-- Grid candidates bound spatial work. ST_Covers tests original GPS points
-- against complete ZCTA polygons; shared-edge matches choose the lowest ZIP.
CREATE TABLE IF NOT EXISTS IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`taxi_zip_cells_2016`') USING DELTA AS
SELECT zip, ST_AsBinary(ST_GeomFromGeoJSON(geometry)) AS boundary_wkb, lon_bin, lat_bin
FROM read_files(
  '/Volumes/' || :catalog || '/' || :schema || '/taxi_sources/nyc-zcta.jsonl',
  format => 'json',
  schema => 'zip STRING, geometry STRING, min_x DOUBLE, max_x DOUBLE, min_y DOUBLE, max_y DOUBLE'
) AS z,
LATERAL explode(sequence(CAST(floor(min_x * 100) AS INT), CAST(floor(max_x * 100) AS INT))) AS x(lon_bin),
LATERAL explode(sequence(CAST(floor(min_y * 100) AS INT), CAST(floor(max_y * 100) AS INT))) AS y(lat_bin);

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trip_locations_2016`')
USING DELTA AS
WITH locations AS (
  SELECT pickup_longitude AS longitude, pickup_latitude AS latitude
  FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016_raw`') WHERE analytics_valid AND pickup_coordinates_valid
  UNION
  SELECT dropoff_longitude, dropoff_latitude
  FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016_raw`') WHERE analytics_valid AND dropoff_coordinates_valid
)
SELECT /*+ BROADCAST(z) */ longitude, latitude, MIN(z.zip) AS zip
FROM locations AS p
LEFT JOIN IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`taxi_zip_cells_2016`') AS z
  ON CAST(floor(p.longitude * 100) AS INT) = z.lon_bin
  AND CAST(floor(p.latitude * 100) AS INT) = z.lat_bin
  AND ST_Covers(ST_GeomFromWKB(z.boundary_wkb, 4326), ST_Point(p.longitude, p.latitude, 4326))
GROUP BY longitude, latitude;

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016`')
USING DELTA
CLUSTER BY (tpep_pickup_datetime, pickup_zip) AS
SELECT q.*, p.zip AS pickup_zip, d.zip AS dropoff_zip
FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016_raw`') AS q
LEFT JOIN IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trip_locations_2016`') AS p
  ON q.pickup_coordinates_valid AND q.pickup_longitude = p.longitude AND q.pickup_latitude = p.latitude
LEFT JOIN IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trip_locations_2016`') AS d
  ON q.dropoff_coordinates_valid AND q.dropoff_longitude = d.longitude AND q.dropoff_latitude = d.latitude
WHERE q.analytics_valid;

-- COMMAND ----------

CREATE OR REPLACE VIEW IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trip_quality_2016`') AS
SELECT source_file, COUNT(*) AS raw_trips,
  count_if(analytics_valid) AS accepted_trips,
  count_if(NOT analytics_valid) AS rejected_trips,
  count_if(analytics_valid AND NOT pickup_coordinates_valid) AS accepted_without_pickup_gps,
  count_if(analytics_valid AND NOT dropoff_coordinates_valid) AS accepted_without_dropoff_gps
FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016_raw`') GROUP BY source_file;

-- COMMAND ----------

SELECT assert_true(
  COUNT(*) > 10000000 AND COUNT(DISTINCT trip_id) = COUNT(*)
    AND count_if(trip_id IS NULL OR NOT analytics_valid) = 0
    AND COUNT(*) = (SELECT count_if(analytics_valid) FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016_raw`')),
  'Expected a complete accepted-trip snapshot with unique, persisted IDs.'
)
FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips_2016`');

-- COMMAND ----------

BEGIN
  DECLARE grant_sql STRING;
  SET grant_sql = 'GRANT USE CATALOG ON CATALOG `' || :catalog || '` TO `' || :app_service_principal_id || '`';
  EXECUTE IMMEDIATE grant_sql;
  SET grant_sql = 'GRANT USE SCHEMA ON SCHEMA `' || :catalog || '`.`' || :schema || '` TO `' || :app_service_principal_id || '`';
  EXECUTE IMMEDIATE grant_sql;
  SET grant_sql = 'GRANT SELECT ON TABLE `' || :catalog || '`.`' || :schema || '`.`trips_2016` TO `' || :app_service_principal_id || '`';
  EXECUTE IMMEDIATE grant_sql;
  SET grant_sql = 'GRANT SELECT ON VIEW `' || :catalog || '`.`' || :schema || '`.`trip_quality_2016` TO `' || :app_service_principal_id || '`';
  EXECUTE IMMEDIATE grant_sql;
END;

-- COMMAND ----------

SELECT * FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trip_quality_2016`') ORDER BY source_file;
