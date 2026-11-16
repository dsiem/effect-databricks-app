import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One-time, idempotent migration of the public map routes and API contract.
const root = fileURLToPath(new URL("../", import.meta.url));
const self = "scripts/migrate-trip-map.mjs";
const replacements = [
  ["/gps-map", "/trip-map"],
  ["gps-activity", "trip-map"],
  ["gpsActivity", "tripMap"],
  ["GpsActivity", "TripMap"],
];
const paths = new Set(
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  ).split("\0"),
);
let changed = 0;
for (const path of paths) {
  if (path === self || !/\.(?:ts|mjs|md|yml)$/.test(path)) continue;
  const absolute = new URL(path, new URL("../", import.meta.url));
  if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) continue;
  const before = readFileSync(absolute, "utf8");
  const after = replacements.reduce(
    (source, [from, to]) => source.replaceAll(from, to),
    before,
  );
  if (before === after) continue;
  writeFileSync(absolute, after);
  console.log(path);
  changed++;
}
console.log(`Updated ${changed} files.`);
