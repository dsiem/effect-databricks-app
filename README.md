# Databricks Apps + Effect

Metrocab is a TypeScript starter for Databricks Apps. The example uses historical
NYC taxi trips to show how to query Databricks SQL, ask Genie about the current
view, and save shared work in Lakebase.

[Deploy the example](DEPLOYMENT.md) ·
[Use your own data](#use-your-own-data) ·
[Reuse the SQL adapter](packages/sql-databricks/README.md)

![NYC taxi overview with trip metrics, a daily activity chart, and the Genie helper](.github/assets/nyc-taxi.png)

## What the example does

- **Databricks SQL** filters and pages trip records and computes charts and map
  aggregates. The trip map shows the busiest H3 cells and reports its coverage.
- **Genie** answers questions using the active filters and the selected chart,
  record, or map area. The app displays answers, result tables, and generated SQL.
- **Lakebase** stores saved filters, findings, and comments on trip records.

Effect manages server services and their lifetimes. The server and the Foldkit
client share the same HTTP contract and runtime schemas. [HTTP contract](shared/api.ts)

## Use your own data

Deploy the example once to set up the Databricks resources and write your local
connection settings. Run `npm run dev` to start the client and API with your
Databricks CLI login. [Deployment guide](DEPLOYMENT.md)

| Replace                       | Start here                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Sample data and queries       | [Seed job](jobs/seed-trip-snapshot.sql) and [analytics service](server/src/analytics.ts) |
| API and data types            | [Shared HTTP contract](shared/api.ts) and [domain schemas](shared/domain.ts)             |
| Filters and views             | [Foldkit features](client/src/features)                                                  |
| Genie tables and instructions | [Genie resource](resources/genie.yml)                                                    |
| Workspace resources           | [Databricks bundle](databricks.yml)                                                      |

The deployed app uses its service principal for data access. Saved views and
comments are shared across viewers. If your users have different permissions,
enforce record access in the API handlers. [API handlers](server/src/routes.ts)

Run `npm run check` to verify a change. [Browser and deployment checks](DEPLOYMENT.md#verify-the-app)

[Taxi data and asset sources](client/public/SOURCES.md)
