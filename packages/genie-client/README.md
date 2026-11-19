# Genie Client for Effect

Use Databricks Genie in Chat and Agent mode from Node.js 22.19+ with Effect
`~4.1.4`. `@dsiem/genie-client` is a private npm workspace package.
[Databricks Genie API](https://docs.databricks.com/api/genie/v1/conversation)

This project is independently maintained and is not affiliated with or endorsed by Databricks, Inc.

## Build from this workspace

Run `npm run build --workspace @dsiem/genie-client` at the repository root.

## Chat mode

Pass a Genie space ID and a `request` function that sends authenticated
requests and returns the parsed JSON body in an Effect.
[App transport](../../server/src/genie.ts)

```ts
import { Effect } from "effect";
import { makeGenieClient } from "@dsiem/genie-client";

const client = makeGenieClient({ spaceId, request });
const operation = await Effect.runPromise(
  client.submit({ content: "What data is available?" }),
);
```

- Save the operation from `submit` to resume the turn later. Pass its
  `conversationId` to `submit` for follow-up questions.
- Call `poll(operation)` to check status once. Set the polling interval and
  deadline in your application.
- Call `result(operation)` when the turn completes to get the message
  attachments. Inline query results can be partial.

A lost submission response can leave an accepted turn. Check Genie before
resubmitting.

## Agent mode

Agent mode requires workspace access to the Databricks Agent mode API. Pass the
Genie space ID as `agentId` to `makeGenieAgentClient({ agentId, request })`.
For `agent-submit`, send the supplied JSON body. Pass the server-sent events to
`readGenieAgentAcceptance` as an Effect stream of bytes and return the resulting
Effect. For `agent-items` and `agent-cancel`, return the parsed JSON body in an
Effect.

Use `submit`, `poll`, and `result` as in Chat mode. Agent operations carry a
response ID, and `result` returns the final report. Use each conversation ID
with the mode that created it. Call `cancel(operation)` to stop an Agent
response in Databricks.
