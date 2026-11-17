WITH week_starts AS (
  SELECT CAST(:baseline_week AS DATE) AS baseline_week,
    CAST(:comparison_week AS DATE) AS comparison_week
),
trips AS (
  SELECT pickup_zip, dropoff_zip,
    CASE
      WHEN hour(tpep_pickup_datetime) < 6 THEN 'overnight'
      WHEN hour(tpep_pickup_datetime) < 12 THEN 'morning'
      WHEN hour(tpep_pickup_datetime) < 18 THEN 'afternoon'
      ELSE 'evening'
    END AS time_band,
    timestampdiff(SECOND, tpep_pickup_datetime, tpep_dropoff_datetime) / 60.0 AS duration_minutes,
    tpep_pickup_datetime >= baseline_week
      AND tpep_pickup_datetime < date_add(baseline_week, 7) AS in_baseline,
    tpep_pickup_datetime >= comparison_week
      AND tpep_pickup_datetime < date_add(comparison_week, 7) AS in_comparison
  FROM IDENTIFIER(:snapshot_table)
  CROSS JOIN week_starts
  WHERE pickup_zip IS NOT NULL AND dropoff_zip IS NOT NULL
),
route_stats AS (
  SELECT pickup_zip, dropoff_zip, time_band,
    count_if(in_baseline) AS baseline_count,
    count_if(in_comparison) AS comparison_count,
    percentile_approx(duration_minutes, 0.9) FILTER (WHERE in_baseline) AS baseline_p90_minutes,
    percentile_approx(duration_minutes, 0.9) FILTER (WHERE in_comparison) AS comparison_p90_minutes
  FROM trips
  WHERE in_baseline OR in_comparison
  GROUP BY pickup_zip, dropoff_zip, time_band
),
ranked AS (
  SELECT row_number() OVER (
      ORDER BY abs(comparison_p90_minutes - baseline_p90_minutes) DESC, pickup_zip, dropoff_zip, time_band
    ) AS position,
    named_struct(
      'pickupZip', pickup_zip,
      'dropoffZip', dropoff_zip,
      'timeBand', time_band,
      'baselineCount', baseline_count,
      'comparisonCount', comparison_count,
      'baselineP90Minutes', baseline_p90_minutes,
      'comparisonP90Minutes', comparison_p90_minutes
    ) AS route
  FROM route_stats
  WHERE baseline_count >= CAST(:minimum_trips AS BIGINT)
    AND comparison_count >= CAST(:minimum_trips AS BIGINT)
  QUALIFY position <= 50
)
MERGE INTO IDENTIFIER(:results_table) AS target
USING (
  SELECT CAST(:analysis_run_id AS BIGINT) AS run_id,
    to_json(named_struct(
      'input', named_struct(
        'baselineWeek', CAST(CAST(:baseline_week AS DATE) AS STRING),
        'comparisonWeek', CAST(CAST(:comparison_week AS DATE) AS STRING),
        'minimumTrips', CAST(:minimum_trips AS BIGINT)
      ),
      'rows', transform(
        sort_array(collect_list(named_struct('position', position, 'route', route))),
        entry -> entry.route
      )
    )) AS report_json
  FROM ranked
) AS report
ON target.run_id = report.run_id
WHEN MATCHED THEN UPDATE SET report_json = report.report_json
WHEN NOT MATCHED THEN INSERT (run_id, report_json) VALUES (report.run_id, report.report_json);
