import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";
import type { Note } from "../src/domain.js";

const run = promisify(execFile);

for (const failure of [null, "warehouse", "create", "list", "genie"] as const) {
  test(`hosted verification ${failure ? `fails on ${failure} errors despite RUNNING` : "checks SQL, paginated persistence, and Genie"}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "deployed-check-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let saved: Note | undefined;
    let created = 0;
    let deleted = 0;
    let followedCursor = false;
    const operation = { conversationId: "conversation", messageId: "message" };
    const cursor = {
      id: "472a6613-2337-4af1-a416-e9b6b61064dd",
      pinned: true,
      updatedAt: "2026-11-13T10:00:00.000001Z",
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      assert.equal(request.headers.authorization, "Bearer test-token");
      const reply = (value: unknown, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === "/health") return reply({ status: "ok" });
      if (url.pathname === "/api/metadata")
        return failure === "warehouse"
          ? reply({ error: { message: "Warehouse unavailable" } }, 503)
          : reply({ trips: 10 });
      if (url.pathname === "/api/overview")
        return reply({ summary: { trips: 10 } });
      if (url.pathname === "/api/notes" && request.method === "PUT") {
        if (failure === "create")
          return reply({ error: { message: "Create failed" } }, 503);
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        saved = {
          ...JSON.parse(Buffer.concat(chunks).toString()),
          version: 1,
        } as Note;
        created++;
        return reply(saved);
      }
      if (url.pathname === "/api/notes" && request.method === "GET") {
        if (failure === "list")
          return reply({ error: { message: "Listing unavailable" } }, 503);
        if (url.searchParams.has("cursor")) {
          assert.deepEqual(
            JSON.parse(url.searchParams.get("cursor") ?? ""),
            cursor,
          );
          followedCursor = true;
          return reply({ rows: saved ? [saved] : [], nextCursor: null });
        }
        // A newly created unpinned note can sit behind existing pinned notes.
        return reply({ rows: [{ id: cursor.id }], nextCursor: cursor });
      }
      if (
        url.pathname.startsWith("/api/notes/") &&
        request.method === "DELETE"
      ) {
        assert.equal(url.pathname, `/api/notes/${saved?.id}`);
        assert.equal(url.searchParams.get("version"), String(saved?.version));
        deleted++;
        saved = undefined;
        return reply({ deleted: true });
      }
      if (url.pathname === "/api/genie") return reply(operation);
      if (url.pathname.endsWith("/result"))
        return reply({
          ...operation,
          queries: [{ rows: [[failure === "genie" ? "999" : "10"]] }],
        });
      if (url.pathname === "/api/genie/conversation/messages/message")
        return reply({
          ...operation,
          state: "completed",
          status: "COMPLETED",
        });
      reply({ error: "Unexpected route" }, 404);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const responses = {
      "bundle summary": { resources: { apps: { app: { name: "test-app" } } } },
      "apps get": {
        app_status: { state: "RUNNING" },
        url: `http://127.0.0.1:${address.port}`,
      },
      "auth token": { access_token: "test-token" },
    };
    await writeFile(
      join(directory, "databricks"),
      `#!/usr/bin/env node
const responses = ${JSON.stringify(responses)};
console.log(JSON.stringify(responses[process.argv.slice(2, 4).join(" ")]));
`,
      { mode: 0o700 },
    );
    const verification = run(
      process.execPath,
      [resolve("scripts/check-deployed.mjs"), "dev"],
      {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        timeout: 15_000,
      },
    );
    if (failure) await assert.rejects(verification);
    else assert.match((await verification).stdout, /Deployed app verified/);
    assert.equal(
      created,
      failure === "warehouse" || failure === "create" ? 0 : 1,
    );
    assert.equal(
      deleted,
      created,
      "verification must clean up its temporary note on success and failure",
    );
    assert.equal(followedCursor, !failure || failure === "genie");
  });
}

test("CI and deployment require offline browser checks, and deployment requires hosted API verification", async () => {
  type Workflow = {
    jobs: Record<
      string,
      {
        needs?: string;
        steps: Array<{ name?: string; run?: string }>;
      }
    >;
  };
  for (const filename of ["ci.yml", "deploy.yml"]) {
    const workflow = parse(
      await readFile(`.github/workflows/${filename}`, "utf8"),
    ) as Workflow;
    const commands = workflow.jobs.check?.steps.map((step) => step.run) ?? [];
    const check = commands.indexOf("npm run check");
    const install = commands.indexOf(
      "npx playwright install --with-deps chromium",
    );
    const browser = commands.indexOf("npm run test:browser");
    assert.ok(check >= 0 && install > check && browser > install, filename);
    if (filename === "deploy.yml") {
      const deploy = workflow.jobs.deploy;
      assert.ok(deploy);
      assert.equal(deploy.needs, "check");
      const wait = deploy.steps.findIndex(
        (step) => step.name === "Wait for the app to run",
      );
      const verify = deploy.steps.findIndex(
        (step) =>
          step.run === 'node scripts/check-deployed.mjs "$BUNDLE_TARGET"',
      );
      assert.ok(
        wait >= 0 && verify > wait,
        "RUNNING must be followed by hosted API verification",
      );
    }
  }
});
