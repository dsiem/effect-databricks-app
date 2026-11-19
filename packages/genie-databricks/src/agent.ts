import { Effect, Option, Schema, Stream } from "effect";
import { Sse } from "effect/encoding";
import type { GenieAttachment, GenieProgress } from "./index.js";
import {
  decode,
  GenieId,
  GenieMessageUnavailable,
  GenieResponseError,
} from "./protocol.js";

export interface GenieAgentOperation {
  readonly conversationId: string;
  readonly responseId: string;
}

type SubmitBody = {
  readonly input: ReadonlyArray<{
    readonly type: "message";
    readonly role: "user";
    readonly content: ReadonlyArray<{
      readonly type: "input_text";
      readonly text: string;
    }>;
  }>;
  readonly conversation_id?: string;
};

export type GenieAgentRequest =
  | {
      readonly kind: "agent-submit";
      readonly method: "POST";
      readonly path: string;
      readonly body: SubmitBody;
    }
  | {
      readonly kind: "agent-items";
      readonly method: "GET";
      readonly path: string;
      readonly body?: never;
    };

const Acceptance = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal("response.created"),
    response: Schema.Struct({ id: GenieId, conversation_id: GenieId }),
  }),
);

export const readGenieAgentAcceptance = <E, R>(
  body: Stream.Stream<Uint8Array, E, R>,
) =>
  body.pipe(
    Stream.decodeText,
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.filter(({ event }) => event === "response.created"),
    Stream.runHead,
    Effect.flatMap((event) =>
      Option.isSome(event)
        ? Effect.succeed(event.value.data)
        : Effect.fail(
            new GenieResponseError({
              cause: new Error("Genie stream ended before response.created"),
            }),
          ),
    ),
  );

const Item = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  role: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.Unknown),
});
type Item = typeof Item.Type;

const Page = Schema.Struct({
  data: Schema.Array(Item),
  status: Schema.String,
  has_more: Schema.Boolean,
  last_id: Schema.optionalKey(Schema.String),
});

const Report = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    text: Schema.optionalKey(Schema.String),
    metadata: Schema.optionalKey(Schema.Unknown),
  }),
);

const Table = Schema.Struct({
  status: Schema.Literal("available"),
  sql: Schema.String,
  columns: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.optionalKey(Schema.String),
    }),
  ),
  preview_rows: Schema.Array(Schema.Array(Schema.NullOr(Schema.String))),
  total_row_count: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

const decodeTable = Schema.decodeUnknownOption(Table);
const userInput = (item: Item) =>
  item.type === "message" && item.role === "user";

const stateOf = (status: string): GenieProgress["state"] => {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return "pending";
  }
};

export const makeGenieAgentClient = <E, R>(options: {
  readonly agentId: string;
  readonly request: (
    request: GenieAgentRequest,
  ) => Effect.Effect<unknown, E, R>;
}) => {
  const { request } = options;
  const agent = `/api/2.0/genie/agents/${encodeURIComponent(options.agentId)}`;

  const submit = (input: {
    readonly content: string;
    readonly conversationId?: string;
  }) =>
    Effect.gen(function* () {
      const data = yield* request({
        kind: "agent-submit",
        method: "POST",
        path: `${agent}/responses`,
        body: {
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: input.content }],
            },
          ],
          ...(input.conversationId === undefined
            ? {}
            : { conversation_id: input.conversationId }),
        },
      });
      const { response } = yield* decode(Acceptance, data);
      return {
        conversationId: response.conversation_id,
        responseId: response.id,
      };
    }).pipe(Effect.withSpan("genie.agent.submit"));

  const readTurn = ({ conversationId, responseId }: GenieAgentOperation) =>
    Effect.gen(function* () {
      const path = `${agent}/conversations/${encodeURIComponent(conversationId)}/items`;
      const marker = `${responseId}_input`;
      const items: Item[] = [];
      const cursors = new Set<string>();
      let after: string | undefined;
      let found = false;
      while (true) {
        const data = yield* request({
          kind: "agent-items",
          method: "GET",
          path:
            after === undefined
              ? path
              : `${path}?after=${encodeURIComponent(after)}`,
        });
        const page = yield* decode(Page, data);
        for (const item of page.data) {
          if (userInput(item)) {
            if (found) {
              const last = items.findLast(
                (entry) =>
                  entry.type === "message" &&
                  (entry.role === "assistant" || entry.role === "system"),
              );
              return {
                items,
                status:
                  last?.role === "assistant"
                    ? (last.status ?? "completed")
                    : "failed",
              };
            }
            found = item.id === marker;
          } else if (found) {
            items.push(item);
          }
        }
        if (!page.has_more)
          return { items, status: found ? page.status : "in_progress" };
        if (!page.last_id || cursors.has(page.last_id)) {
          return yield* new GenieResponseError({
            cause: new Error("Genie returned an invalid items cursor"),
          });
        }
        after = page.last_id;
        cursors.add(after);
      }
    });

  const poll = (operation: GenieAgentOperation) =>
    readTurn(operation).pipe(
      Effect.map(({ status }) => ({
        ...operation,
        status,
        state: stateOf(status),
      })),
      Effect.withSpan("genie.agent.poll"),
    );

  const result = (operation: GenieAgentOperation) =>
    Effect.gen(function* () {
      const { items, status } = yield* readTurn(operation);
      const state = stateOf(status);
      if (state !== "completed")
        return yield* new GenieMessageUnavailable({ state, status });
      const attachments: GenieAttachment[] = [];
      for (const item of items) {
        if (item.type !== "message" || item.role !== "assistant") continue;
        const content = yield* decode(Report, item.content);
        for (const [index, part] of content.entries()) {
          if (part.type !== "output_text" || part.text === undefined) continue;
          const table = decodeTable(part.metadata);
          if (Option.isNone(table)) {
            attachments.push({ kind: "text", content: part.text });
            continue;
          }
          const {
            sql,
            columns,
            preview_rows: rows,
            total_row_count: totalRowCount,
          } = table.value;
          attachments.push({
            kind: "query",
            attachmentId: `${item.id}:${index}`,
            sql,
            columns: columns.map(({ name, type }) => ({
              name,
              ...(type === undefined ? {} : { typeName: type }),
            })),
            rows,
            truncated: totalRowCount != null && totalRowCount > rows.length,
            ...(totalRowCount == null ? {} : { totalRowCount }),
          });
        }
      }
      return { ...operation, attachments };
    }).pipe(Effect.withSpan("genie.agent.result"));

  return { submit, poll, result };
};
