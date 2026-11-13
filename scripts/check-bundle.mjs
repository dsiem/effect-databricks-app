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
assert.ok(
  validate(bundle),
  ajv.errorsText(validate.errors, { separator: "\n" }),
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
