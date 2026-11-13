# Databricks Effect App

A TypeScript foundation for a Databricks App built with Effect 4. The initial app
serves JSON at `/` and a process health check at `/health`. It starts without
Databricks credentials, so local development and CI are independent of a workspace.

Lakebase, Lakehouse SQL, and Genie are the intended data services. Resource-binding
examples and the implementation path are in [docs/data-access.md](docs/data-access.md).
The workspace includes [effect-sql-databricks](packages/sql-databricks/README.md),
an Effect SQL warehouse adapter with Arrow tables, record batches, and IPC chunks.
Application queries and a UI are future work.

## Local development

Use Node **22.19 or newer within Node 22** and npm 10. Effect's Node adapter requires
at least 22.19; `.nvmrc` selects the latest Node 22 patch. Databricks Apps currently
provides Node 22 ([runtime documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/system-env)).

```sh
nvm install
nvm use
npm ci
cp .env.example .env
npm run dev
```

Open <http://localhost:3000/health>. Local development uses HTTP/1.1; `app.yaml`
selects HTTP/2 cleartext for Databricks' reverse proxy. Both bind to `0.0.0.0` and
read `DATABRICKS_APP_PORT` (default `3000`). Empty environment values use defaults;
invalid nonempty values fail startup. The health response reports process
liveness, without claiming that any data service is reachable.

```sh
npm run check       # format/lint, types, config tests, build, built-app smoke check
npm run format     # apply formatting and safe lint fixes
npm run build
npm start
```

The smoke check launches the compiled entry point on an ephemeral port for both
HTTP/1.1 and HTTP/2, checks routes and 404 behavior, and verifies graceful SIGTERM
shutdown. Effect manages the server lifetime and signal handling. Server shutdown
allows five seconds for draining connections.

TypeScript and Node's type declarations are runtime dependencies because Databricks
runs `npm run build` during deployment, including when development dependencies are
omitted. Versions are pinned and `package-lock.json` is committed.

## Deploy with a bundle

Install [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install)
**1.26.0 or newer, below 2.0**. The bundle uses Declarative Automation Bundles,
formerly Databricks Asset Bundles. It uploads source; Databricks installs packages
and builds the app. No container image or Python runtime is needed for this code.

Set your workspace URL, log in, then validate and deploy:

```sh
export DATABRICKS_HOST="https://<your-workspace-host>"
databricks auth login --host "$DATABRICKS_HOST" --profile dev
npm run bundle:check
databricks bundle validate --strict -t dev -p dev
databricks bundle deploy -t dev -p dev
databricks bundle run app -t dev -p dev
```

`app` is the bundle resource key. `bundle deploy` uploads code and updates
resources; `bundle run app` starts the new code. Check the app in the workspace
afterward: the start command can return before the app is healthy.

`bundle:check` validates the bundle and the opt-in data example against the
installed CLI's JSON schema without credentials. `bundle validate` additionally
resolves variables and checks workspace configuration; it requires authentication.

The `dev` target defaults to a developer-specific app name. If the normalized name
exceeds Databricks' 30-character limit or collides with another developer, use a
short unique override in your shell:

```sh
export BUNDLE_VAR_app_name=effect-yourname-dev
```

Or persist it in the ignored `.databricks/bundle/dev/variable-overrides.json`:

```json
{ "app_name": "effect-yourname-dev" }
```

The `prod` target uses the stable app name `databricks-effect-app` and bundle state
under `/Workspace/Shared/.bundle/databricks-effect-app/prod`. Deploy it with a
dedicated service principal that can create/manage apps and write this workspace
path. Supply the production workspace through authentication configuration or
`DATABRICKS_HOST`. App data access uses a separate, platform-created app identity.

## CI and deployment automation

GitHub Actions runs `npm run check` and `npm run bundle:check` for pull requests and
pushes to `main`. The separate **Deploy** workflow is manually triggered with a
`dev` or `prod` target, runs the same checks, validates against the workspace,
deploys, starts the app, and polls for `RUNNING` for up to ten minutes.

To enable deployment after creating a GitHub repository:

1. Create GitHub environments named `dev` and `prod`.
2. Set environment variables `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID` (the deployer
   service principal's application ID), and `DATABRICKS_APP_NAME` (a unique app name
   for that target). Use the same name for every deployment to that target.
3. Configure a Databricks service principal federation policy for the GitHub
   environment subject `repo:OWNER/REPO:environment:dev` or
   `repo:OWNER/REPO:environment:prod`, issuer
   `https://token.actions.githubusercontent.com`, and your Databricks account ID as
   audience. Assign the deployer to the workspace with the required permissions.
4. Push this repository and run the Deploy workflow for the selected environment.

Authentication uses `github-oidc`; no long-lived Databricks token or client secret
is stored in GitHub. See [Databricks federation setup](https://docs.databricks.com/aws/en/dev-tools/auth/provider-github).
The workflow serializes deployments per target. Environment deployment rules can
control which branches may deploy to production.

## Structure

```text
src/config.ts               Effect Config schemas at the environment boundary
src/routes.ts               Effect HTTP routes
src/main.ts                 Node server layer and main runtime
test/config.test.ts         Configuration behavior checks
scripts/smoke.mjs           Verify the actual compiled app over both protocols
scripts/check-bundle.mjs    Check YAML with the installed Databricks schema
packages/sql-databricks/     Reusable Effect SQL adapter with native Arrow results
app.yaml                    Databricks start command and runtime configuration
databricks.yml              App resource, source sync, dev/prod targets
examples/data-resources.yml Opt-in bindings for existing data resources
```

Secrets, local `.env` files, bundle state, dependencies, and build output are
ignored by Git. Only `.env.example` is tracked. No remote repository, workspace
resources, or data grants are created by the scaffold itself.
