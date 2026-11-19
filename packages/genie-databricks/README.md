# Databricks Genie for Effect

`effect-genie-databricks` is a private npm workspace package for Chat and Agent mode in the
[Genie API](https://docs.databricks.com/api/genie/v1/conversation).
Build it with `npm run build --workspace effect-genie-databricks`.

Create a Chat client with a space ID and an Effect that makes authenticated requests.
The client passes through errors and requirements from your transport. Each
client can use a different space, workspace, or identity.

```ts
import { Effect, Redacted } from "effect";
import { makeGenieClient } from "effect-genie-databricks";

const client = makeGenieClient({
  spaceId,
  request: ({ path, method, body }) =>
    Effect.gen(function* () {
      const token = yield* accessToken;
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(new URL(path, workspaceUrl), {
            method,
            headers: {
              Authorization: `Bearer ${Redacted.value(token)}`,
              "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: "error",
            signal,
          });
          if (!response.ok)
            throw new Error(`Databricks HTTP ${response.status}`);
          const data: unknown = await response.json();
          return data;
        },
        catch: (cause) => cause,
      });
    }),
});
```

In the example, `workspaceUrl` is your workspace URL and `accessToken` is
your Effect that supplies a redacted token for the caller's identity.

- `submit({ content, conversationId? })` returns the accepted conversation and
  message IDs. Save them to resume later. Use the conversation ID for follow-ups.
  A lost submission response can leave an accepted turn. Check Genie before
  repeating the POST.
- `poll(operation)` reads status once. Set the interval and deadline at the
  call site. Interrupting a local wait leaves the remote turn available.
- `result(operation)` reads a completed turn and fetches each query attachment's
  inline result. It returns attachments in message order, including all returned
  inline rows and any available column, row count, and next chunk metadata.
  Databricks can return a partial result. Full-result downloads use separate API
  endpoints.

Transport errors pass through directly. Invalid responses fail with
`GenieResponseError`. Genie reports message state, warehouse or query permission
failures, and attachment execution errors through distinct tagged errors.

## Agent mode

Use `makeGenieAgentClient({ agentId, request })` with the same Genie space ID.
When the request kind is `agent-submit`, send the provided body as JSON and pass
the SSE response body to `readGenieAgentAcceptance`. The helper accepts an
Effect stream of bytes and stops at `response.created`. For `agent-items`,
return the decoded JSON body.

Save the returned conversation and response IDs. Use them with `poll` and
`result` to resume the turn through the conversation items API. The result
contains the final report, including its citation links and structured SQL
previews. Use mode-specific conversation IDs for follow-ups. The app uses
`GENIE_SPACE_ID` for both modes and exposes the mode selector in the Genie
composer. Databricks workspace access to Agent mode is required.
