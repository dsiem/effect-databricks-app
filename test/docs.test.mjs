import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { marked } from "marked";

const files = execFileSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "*.md",
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((file) => file && existsSync(file));
const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
const failures = [];

for (const file of files) {
  const markdown = readFileSync(file, "utf8");
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type !== "link" && token.type !== "image") return;
    if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(token.href)) return;
    const target = decodeURIComponent(token.href.split(/[?#]/, 1)[0]);
    if (!existsSync(resolve(dirname(file), target)))
      failures.push(`${file}: missing link target ${token.href}`);
  });
  for (const [, command] of markdown.matchAll(/\bnpm run ([\w:-]+)/g)) {
    if (!Object.hasOwn(scripts, command))
      failures.push(`${file}: unknown npm script ${command}`);
  }
}

assert.equal(failures.length, 0, failures.join("\n"));
console.log("Documentation links and npm commands verified");
