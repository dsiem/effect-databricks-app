# Data access direction

The initial app implements the HTTP runtime and deployment foundation. It does not
yet query data or authenticate to Databricks APIs. The reusable
[effect-sql-databricks](../packages/sql-databricks/README.md) package implements
Lakehouse SQL over Arrow, but is not yet wired into application routes. Add each
integration as an Effect service with an explicit `Layer` in `src/main.ts`; keep transport and
credentials behind the service boundary.

| Service   | Access path                             | Initial integration work                                                                                                                       |
| --------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Lakebase  | PostgreSQL protocol                     | Select Autoscaling or Provisioned, add the database resource, implement a scoped connection pool and refreshing OAuth credentials.             |
| Lakehouse | SQL warehouse / Statement Execution API | Bind an existing warehouse, grant Unity Catalog access, provide the Databricks client layer, and add application queries using its Arrow APIs. |
| Genie     | Genie conversation REST API             | Bind an existing space, start conversations, send follow-up messages, and poll message/query results.                                          |

Use Effect `Config` for environment inputs, `Schema` for external responses,
typed errors for expected failures, and scoped acquisition/release for connections.
Keep domain operations independent of HTTP routing. Grant the app identity access
before connecting; a valid token alone does not grant table access.

For Lakehouse row queries, use `effect/sql/SqlSchema` to encode inputs and validate
results before they enter domain code. For Arrow results, validate the expected
field names and Arrow types. Wrap stream consumers with `sql.withQueryTimeout`
when the deadline must include downstream processing. The adapter's generic SQL
service does not provide sessions or transactions; its dialect fallback is Spark
SQL, so branch on `sql.driver` rather than assuming MySQL compatibility.

## Bind existing resources

[examples/data-resources.yml](../examples/data-resources.yml) is an opt-in example,
excluded from the deployed source and not included by the bundle. Its resource
shape is checked by `npm run bundle:check`.

Once the actual resources are selected:

1. Copy its variable declarations into `databricks.yml` and set their values for
   each target. Copy `resources.apps.app.resources` into the matching app resource.
2. Reference resource keys in `app.yaml` with `valueFrom`. For example:

   ```yaml
   env:
     - name: APP_HTTP_PROTOCOL
       value: "http2"
     - name: DATABRICKS_WAREHOUSE_ID
       valueFrom: lakehouse
     - name: GENIE_SPACE_ID
       valueFrom: genie
   ```

3. Grant the app service principal `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the
   Unity Catalog objects needed for Lakehouse and Genie. The warehouse resource
   grants `CAN_USE`; the Genie resource grants `CAN_VIEW` on the selected space.
4. Implement and test each adapter against a development resource, then redeploy
   and start the app with the bundle.

The Lakebase example uses **Autoscaling** (`postgres`, with a branch resource name
and database name). Provisioned Lakebase uses a different `database` resource
binding with `instance_name` and `database_name`. Select the right model before
adding a driver or migrations. Database grants and schema ownership must be
intentional; avoid creating production schemas during ordinary app startup.

## Authentication and token lifetimes

Databricks injects `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID`, and
`DATABRICKS_CLIENT_SECRET` for the app's own service principal. Use that identity
for shared app access. Keep secrets in redacted configuration and server-side
services; never return them in HTTP responses or logs. The GitHub deployer identity
is separate from this app runtime identity.

For REST calls, use workspace OAuth M2M acquisition and expiry-aware token
refresh behind a shared authenticated HTTP service. The SQL adapter includes a
`Credentials.clientCredentials` provider for its workspace requests. Do not cache
a token forever or retry writes indiscriminately. Lakebase database authentication has its own
credential/token flow; a workspace REST token is not a PostgreSQL password.
Ensure newly opened database connections obtain a valid credential throughout
the pool's lifetime.

If results must respect each viewer's permissions, implement Databricks user
authorization and request the required scopes as a separate feature. The scaffold
does not forward user access tokens. Keep local credentials in the ignored `.env`
file or an appropriate credential provider.

## References

- [App resource definitions](https://docs.databricks.com/aws/en/dev-tools/bundles/resources#app)
- [App resource environment references](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/environment-variables)
- [Lakebase application development](https://docs.databricks.com/aws/en/oltp/projects/build-applications)
- [Statement Execution API](https://docs.databricks.com/aws/en/dev-tools/sql-execution-tutorial)
- [Genie conversation API](https://docs.databricks.com/aws/en/genie/conversation-api)
- [App authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth)
