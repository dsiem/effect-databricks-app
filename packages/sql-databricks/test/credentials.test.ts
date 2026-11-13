import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock, Effect, Redacted } from "effect";
import { Credentials } from "../src/index.js";
import { listen } from "./http.js";

test("OAuth M2M shares concurrent token refreshes and refreshes before expiry", async (t) => {
  const requests: {
    authorization: string | undefined;
    form: URLSearchParams;
  }[] = [];
  const server = await listen(async (req, res) => {
    assert.equal(req.url, "/oidc/v1/token");
    const body = [];
    for await (const chunk of req) body.push(chunk);
    requests.push({
      authorization: req.headers.authorization,
      form: new URLSearchParams(Buffer.concat(body).toString()),
    });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        access_token: `token-${requests.length}`,
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
  });
  t.after(server.close);
  const provider = Credentials.clientCredentials({
    host: server.origin,
    clientId: "app-id",
    clientSecret: Redacted.make("app-secret"),
  });
  let now = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const testClock: Clock.Clock = Object.assign(Object.create(clock), {
        currentTimeMillis: Effect.sync(() => now),
      });
      yield* Effect.gen(function* () {
        const tokens = yield* Effect.all(
          Array.from({ length: 8 }, () => provider),
          { concurrency: "unbounded" },
        );
        assert.ok(tokens.every((token) => Redacted.value(token) === "token-1"));
        assert.equal(requests.length, 1);
        now = 3_500_000;
        assert.equal(Redacted.value(yield* provider), "token-1");
        now = 3_540_001;
        assert.equal(Redacted.value(yield* provider), "token-2");
      }).pipe(Effect.provideService(Clock.Clock, testClock));
    }),
  );
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every(
      (request) =>
        request.authorization ===
        `Basic ${Buffer.from("app-id:app-secret").toString("base64")}`,
    ),
  );
  assert.equal(requests[0]?.form.get("grant_type"), "client_credentials");
  assert.equal(requests[0]?.form.get("scope"), "sql");
});

test("OAuth failures remain typed and do not expose secrets or response bodies", async (t) => {
  const server = await listen(async (_req, res) => {
    res.writeHead(401).end("secret-in-response");
  });
  t.after(server.close);
  const result = await Effect.runPromise(
    Effect.result(
      Credentials.clientCredentials({
        host: server.origin,
        clientId: "app",
        clientSecret: Redacted.make("app-secret"),
      }),
    ),
  );
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure") {
    assert.equal(result.failure.reason._tag, "AuthenticationError");
    assert.ok(!JSON.stringify(result.failure).includes("secret"));
  }
});

test("a shared workspace identity can request the configured OAuth scope", async () => {
  let scope: string | null = null;
  const token = await Effect.runPromise(
    Credentials.clientCredentials({
      host: "https://workspace.example",
      clientId: "app",
      clientSecret: Redacted.make("secret"),
      scope: "all-apis",
      fetch: async (_url, init) => {
        scope = new URLSearchParams(String(init?.body)).get("scope");
        return Response.json({
          access_token: "token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    }),
  );
  assert.equal(scope, "all-apis");
  assert.equal(Redacted.value(token), "token");
});
