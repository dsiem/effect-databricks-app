import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function audit(directory) {
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) {
      files += await audit(url);
      continue;
    }
    if (!/\.[jt]sx?$/.test(entry.name)) continue;
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(
      source,
      /h\.Role\(["'](?:combobox|listbox|option|tab|tablist|tabpanel|tooltip)["']\)/,
      `Use Foldkit UI behavior instead of hand-built widget roles in ${url.pathname}`,
    );
    files++;
  }
  return files;
}
const files = await audit(new URL("client/src/", root));
console.log(`Client UI checks passed: ${files} source modules.`);
