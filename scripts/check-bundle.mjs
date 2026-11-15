import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { parse } from "yaml";

// Use the installed CLI as the schema authority; no workspace or credentials
// needed. Full bundle validation still runs against the workspace on deployment.
const schema = JSON.parse(
  execFileSync("databricks", ["bundle", "schema"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }),
);
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);
const bundle = parse(readFileSync("databricks.yml", "utf8"));
const substitution = (path) => `\${${path}}`;
assert.ok(
  validate(bundle),
  ajv.errorsText(validate.errors, { separator: "\n" }),
);

const seed = bundle.resources.jobs.seed_trip_snapshot;
assert.equal(
  seed.schedule,
  undefined,
  "Snapshot seeding must stay unscheduled",
);
assert.equal(seed.continuous, undefined);
assert.equal(seed.trigger, undefined);
assert.equal(seed.max_concurrent_runs, 1);
assert.equal(seed.tasks.length, 1);
const notebook = seed.tasks[0].notebook_task;
assert.equal(
  notebook.warehouse_id,
  substitution("resources.sql_warehouses.analytics.id"),
  "Snapshot seeding must reuse the analytics warehouse",
);
assert.match(
  readFileSync(notebook.notebook_path, "utf8"),
  /^-- Databricks notebook source\n/,
);

// The managed schema is the single source for the job and app table location.
assert.equal(
  bundle.resources.schemas.data.catalog_name,
  substitution("var.data_catalog"),
);
assert.equal(
  bundle.resources.schemas.data.name,
  substitution("var.data_schema"),
);
const seedParameters = Object.fromEntries(
  seed.parameters.map(({ name, default: value }) => [name, value]),
);
const genie = JSON.parse(bundle.resources.genie_spaces.taxi.serialized_space);
const genieTables = genie.data_sources.tables.map(
  ({ identifier }) => identifier,
);
assert.deepEqual(
  genieTables,
  [...genieTables].sort(),
  "Genie API requires sorted source identifiers",
);
assert.ok(
  genieTables.includes(
    `${substitution("var.data_catalog")}.${substitution("var.data_schema")}.trips_2016`,
  ),
  "Genie must query the target dataset rather than the small public demo",
);
assert.equal(
  seedParameters.catalog,
  substitution("resources.schemas.data.catalog_name"),
);
assert.equal(
  seedParameters.schema,
  substitution("resources.schemas.data.name"),
);
assert.equal(
  bundle.resources.apps.app.config.env.find(
    ({ name }) => name === "TRIP_SNAPSHOT_TABLE",
  )?.value,
  `${seedParameters.catalog}.${seedParameters.schema}.trips_2016`,
  "Seed job and app must use the same catalog, schema, and table",
);

// Check opt-in data bindings in the same resource structure used at deployment.
const dataResources = parse(
  readFileSync("examples/data-resources.yml", "utf8"),
);
assert.ok(
  validate({
    ...bundle,
    variables: { ...bundle.variables, ...dataResources.variables },
    resources: {
      apps: {
        app: {
          ...bundle.resources.apps.app,
          ...dataResources.resources.apps.app,
        },
      },
    },
  }),
  ajv.errorsText(validate.errors, { separator: "\n" }),
);
console.log("Bundle and data-resource example match the installed CLI schema");
