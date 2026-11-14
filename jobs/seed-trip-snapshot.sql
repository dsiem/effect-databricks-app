-- Databricks notebook source
-- One-time snapshot provisioning. Re-running preserves existing rows and trip IDs.
SELECT assert_true(
  :catalog RLIKE '^[A-Za-z_][A-Za-z0-9_-]{0,127}$'
    AND :schema RLIKE '^[A-Za-z_][A-Za-z0-9_-]{0,127}$',
  'Snapshot catalog and schema must be Unity Catalog identifiers.'
);
SELECT assert_true(
  :app_service_principal_id RLIKE '(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'app_service_principal_id must be the Databricks App service principal UUID.'
);

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips`')
USING DELTA AS
SELECT uuid() AS trip_id, source.* FROM samples.nyctaxi.trips AS source;

-- COMMAND ----------

SELECT assert_true(
  COUNT(*) > 0
    AND COUNT(DISTINCT trip_id) = COUNT(*)
    AND COUNT_IF(trip_id IS NULL) = 0,
  'Snapshot validation failed: expected a non-empty table with one non-null unique trip_id per row.'
)
FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips`');

-- COMMAND ----------

-- GRANT requires dynamic SQL on older warehouse runtimes. All identifiers are
-- quoted; the parameters above are validated before any changes are made.
DECLARE OR REPLACE VARIABLE grant_sql STRING;
SET VAR grant_sql = 'GRANT USE CATALOG ON CATALOG `' || :catalog
  || '` TO `' || :app_service_principal_id || '`';
EXECUTE IMMEDIATE grant_sql;

SET VAR grant_sql = 'GRANT USE SCHEMA ON SCHEMA `' || :catalog || '`.`' || :schema
  || '` TO `' || :app_service_principal_id || '`';
EXECUTE IMMEDIATE grant_sql;

SET VAR grant_sql = 'GRANT SELECT ON TABLE `' || :catalog || '`.`' || :schema
  || '`.`trips` TO `' || :app_service_principal_id || '`';
EXECUTE IMMEDIATE grant_sql;

-- COMMAND ----------

SELECT :catalog || '.' || :schema || '.trips' AS snapshot_table, COUNT(*) AS row_count
FROM IDENTIFIER('`' || :catalog || '`.`' || :schema || '`.`trips`');
