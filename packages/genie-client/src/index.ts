import { Data, Effect, Schema } from "effect";

import {
  decode,
  GenieId,
  GenieMessageUnavailable,
  GenieResponseError,
} from "./protocol.js";

export {
  GenieId,
  GenieMessageUnavailable,
  GenieResponseError,
} from "./protocol.js";
export {
  GenieAgentPhase,
  makeGenieAgentClient,
  readGenieAgentAcceptance,
  type GenieAgentOperation,
  type GenieAgentRequest,
} from "./agent.js";

export const GenieOperation = Schema.Struct({
  conversationId: GenieId,
  messageId: GenieId,
});
export type GenieOperation = typeof GenieOperation.Type;

export const GenieProgress = Schema.Struct({
  ...GenieOperation.fields,
  state: Schema.Literals(["pending", "completed", "failed"]),
  status: Schema.String,
});
export type GenieProgress = typeof GenieProgress.Type;

export type GenieRequest =
  | {
      readonly kind: "submit";
      readonly path: string;
      readonly method: "POST";
      readonly body: { readonly content: string };
    }
  | {
      readonly kind: "message" | "query-result";
      readonly path: string;
      readonly method: "GET";
      readonly body?: never;
    };

export class GeniePermissionDenied extends Data.TaggedError(
  "GeniePermissionDenied",
)<{
  readonly source: "warehouse" | "query";
}> {}

export class GenieQueryFailed extends Data.TaggedError("GenieQueryFailed")<{
  readonly attachmentId: string;
  readonly sqlState?: string;
  readonly errorCode?: string;
}> {}

const SubmittedMessage = Schema.Struct({
  message_id: GenieId,
  conversation_id: GenieId,
});

const MessageStatus = Schema.Struct({
  ...SubmittedMessage.fields,
  status: Schema.String,
  error: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ type: Schema.optionalKey(Schema.String) })),
  ),
});

const attachmentId = Schema.optionalKey(Schema.String);
const MessageAttachments = Schema.Struct({
  attachments: Schema.optionalKey(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          attachment_id: attachmentId,
          text: Schema.Struct({ content: Schema.String }),
        }),
        Schema.Struct({
          attachment_id: Schema.String,
          query: Schema.Struct({
            query: Schema.String,
            description: Schema.optionalKey(Schema.String),
          }),
        }),
        Schema.Struct({
          attachment_id: attachmentId,
          suggested_questions: Schema.Unknown,
        }),
        Schema.Struct({ attachment_id: attachmentId, viz: Schema.Unknown }),
      ]),
    ),
  ),
});

const Started = Schema.Struct({
  conversation_id: GenieId,
  message: Schema.Struct({ message_id: GenieId }),
});

const Column = Schema.Struct({
  name: Schema.String,
  type_name: Schema.optionalKey(Schema.String),
  type_text: Schema.optionalKey(Schema.String),
});

const Result = Schema.Struct({
  statement_response: Schema.Struct({
    status: Schema.optionalKey(
      Schema.Struct({
        state: Schema.String,
        sql_state: Schema.optionalKey(Schema.String),
        error: Schema.optionalKey(
          Schema.Struct({ error_code: Schema.optionalKey(Schema.String) }),
        ),
      }),
    ),
    manifest: Schema.optionalKey(
      Schema.Struct({
        truncated: Schema.optionalKey(Schema.Boolean),
        total_row_count: Schema.optionalKey(Schema.Number),
        schema: Schema.Struct({ columns: Schema.Array(Column) }),
      }),
    ),
    result: Schema.optionalKey(
      Schema.Struct({
        data_array: Schema.optionalKey(
          Schema.Array(Schema.Array(Schema.NullOr(Schema.String))),
        ),
        next_chunk_index: Schema.optionalKey(Schema.Number),
      }),
    ),
  }),
});

export type GenieAttachment =
  | {
      readonly kind: "text";
      readonly attachmentId?: string;
      readonly content: string;
    }
  | {
      readonly kind: "suggested-questions";
      readonly attachmentId?: string;
      readonly payload: unknown;
    }
  | {
      readonly kind: "visualization";
      readonly attachmentId?: string;
      readonly payload: unknown;
    }
  | {
      readonly kind: "query";
      readonly attachmentId: string;
      readonly sql: string;
      readonly description?: string;
      readonly columns: ReadonlyArray<{
        readonly name: string;
        readonly typeName?: string;
        readonly typeText?: string;
      }>;
      readonly rows: ReadonlyArray<ReadonlyArray<string | null>>;
      readonly totalRowCount?: number;
      readonly truncated: boolean;
      readonly nextChunkIndex?: number;
    };

export interface GenieResult extends GenieOperation {
  readonly attachments: ReadonlyArray<GenieAttachment>;
}

const messageState = (status: string): GenieProgress["state"] => {
  switch (status) {
    case "COMPLETED":
      return "completed";
    case "FAILED":
    case "CANCELLED":
    case "QUERY_RESULT_EXPIRED":
      return "failed";
    default:
      return "pending";
  }
};

export const makeGenieClient = <E, R>(options: {
  readonly spaceId: string;
  readonly request: (request: GenieRequest) => Effect.Effect<unknown, E, R>;
  readonly attachmentConcurrency?: number;
}) => {
  const { request } = options;
  const space = `/api/2.0/genie/spaces/${encodeURIComponent(options.spaceId)}`;
  const conversationPath = (conversationId: string) =>
    `${space}/conversations/${encodeURIComponent(conversationId)}`;
  const messagePath = (operation: GenieOperation) =>
    `${conversationPath(operation.conversationId)}/messages/${encodeURIComponent(operation.messageId)}`;

  const readMessage = (operation: GenieOperation) =>
    Effect.gen(function* () {
      const data = yield* request({
        kind: "message",
        method: "GET",
        path: messagePath(operation),
      });
      const message = yield* decode(MessageStatus, data);
      if (
        message.status === "FAILED" &&
        message.error?.type === "WAREHOUSE_ACCESS_MISSING_EXCEPTION"
      ) {
        return yield* new GeniePermissionDenied({ source: "warehouse" });
      }
      const progress: GenieProgress = {
        conversationId: message.conversation_id,
        messageId: message.message_id,
        status: message.status,
        state: messageState(message.status),
      };
      return { data, progress };
    });

  const submit = (input: {
    readonly content: string;
    readonly conversationId?: string;
  }) =>
    Effect.gen(function* (): Effect.fn.Return<
      GenieOperation,
      E | GenieResponseError,
      R
    > {
      const body = { content: input.content };
      if (input.conversationId) {
        const data = yield* request({
          kind: "submit",
          method: "POST",
          path: `${conversationPath(input.conversationId)}/messages`,
          body,
        });
        const message = yield* decode(SubmittedMessage, data);
        return {
          conversationId: message.conversation_id,
          messageId: message.message_id,
        };
      }
      const data = yield* request({
        kind: "submit",
        method: "POST",
        path: `${space}/start-conversation`,
        body,
      });
      const started = yield* decode(Started, data);
      return {
        conversationId: started.conversation_id,
        messageId: started.message.message_id,
      };
    }).pipe(Effect.withSpan("genie.submit"));

  const poll = (operation: GenieOperation) =>
    readMessage(operation).pipe(
      Effect.map(({ progress }) => progress),
      Effect.withSpan("genie.poll"),
    );

  const result = (
    operation: GenieOperation,
  ): Effect.Effect<
    GenieResult,
    | E
    | GenieResponseError
    | GeniePermissionDenied
    | GenieMessageUnavailable
    | GenieQueryFailed,
    R
  > =>
    Effect.gen(function* () {
      const { data, progress } = yield* readMessage(operation);
      if (progress.state !== "completed") {
        return yield* new GenieMessageUnavailable({
          status: progress.status,
          state: progress.state,
        });
      }
      const message = yield* decode(MessageAttachments, data);
      const attachments = yield* Effect.forEach(
        message.attachments ?? [],
        (
          attachment,
        ): Effect.Effect<
          GenieAttachment,
          E | GenieResponseError | GeniePermissionDenied | GenieQueryFailed,
          R
        > =>
          Effect.gen(function* () {
            const id =
              attachment.attachment_id === undefined
                ? {}
                : { attachmentId: attachment.attachment_id };
            if ("text" in attachment) {
              return { kind: "text", ...id, content: attachment.text.content };
            }
            if ("suggested_questions" in attachment) {
              return {
                kind: "suggested-questions",
                ...id,
                payload: attachment.suggested_questions,
              };
            }
            if ("viz" in attachment) {
              return { kind: "visualization", ...id, payload: attachment.viz };
            }

            const data = yield* request({
              kind: "query-result",
              method: "GET",
              path: `${messagePath(operation)}/attachments/${encodeURIComponent(attachment.attachment_id)}/query-result`,
            });
            const { statement_response: statement } = yield* decode(
              Result,
              data,
            );
            const status = statement.status;
            if (status?.state === "FAILED") {
              const errorCode = status.error?.error_code;
              const sqlState = status.sql_state;
              if (
                errorCode === "PERMISSION_DENIED" ||
                sqlState?.startsWith("425")
              ) {
                return yield* new GeniePermissionDenied({ source: "query" });
              }
              return yield* new GenieQueryFailed({
                attachmentId: attachment.attachment_id,
                ...(errorCode === undefined ? {} : { errorCode }),
                ...(sqlState === undefined ? {} : { sqlState }),
              });
            }
            const totalRowCount = statement.manifest?.total_row_count;
            const nextChunkIndex = statement.result?.next_chunk_index;
            return {
              kind: "query",
              attachmentId: attachment.attachment_id,
              sql: attachment.query.query,
              ...(attachment.query.description === undefined
                ? {}
                : { description: attachment.query.description }),
              columns: (statement.manifest?.schema.columns ?? []).map(
                (column) => ({
                  name: column.name,
                  ...(column.type_name === undefined
                    ? {}
                    : { typeName: column.type_name }),
                  ...(column.type_text === undefined
                    ? {}
                    : { typeText: column.type_text }),
                }),
              ),
              rows: statement.result?.data_array ?? [],
              truncated: statement.manifest?.truncated === true,
              ...(totalRowCount === undefined ? {} : { totalRowCount }),
              ...(nextChunkIndex === undefined ? {} : { nextChunkIndex }),
            };
          }),
        { concurrency: options.attachmentConcurrency ?? 2 },
      );
      return { ...operation, attachments };
    }).pipe(Effect.withSpan("genie.result"));

  return { submit, poll, result };
};
