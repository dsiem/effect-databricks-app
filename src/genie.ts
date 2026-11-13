import { Context, Effect, Layer, Schema } from "effect";
import { makeAdmission } from "./admission.js";
import { makeCapability } from "./capability.js";
import {
  type CapabilityAvailability,
  type GenieInput,
  GenieOperation,
  type GenieProgress,
  type GenieReply,
} from "./domain.js";
import {
  GenieFailed,
  OperationTimeout,
  type ServiceError,
  UpstreamError,
  unavailable,
} from "./errors.js";
import { Settings } from "./settings.js";
import { Workspace } from "./workspace.js";

const prompt = (input: typeof GenieInput.Type) =>
  `${input.content}\n\nExplore filter context for this question on samples.nyctaxi.trips:\n${JSON.stringify(input.filters ?? {})}\nApply from and to to tpep_pickup_datetime: from is inclusive; to includes the entire day (before midnight of the next day). Apply zip to pickup_zip. Omitted bounds or ZIP mean unrestricted. Use this context for this question instead of inheriting earlier Explore filters.`;

const SubmittedMessage = Schema.Struct({
  message_id: GenieOperation.fields.messageId,
  conversation_id: GenieOperation.fields.conversationId,
});
const MessageStatus = Schema.Struct({
  ...SubmittedMessage.fields,
  status: Schema.String,
});
const Message = Schema.Struct({
  ...MessageStatus.fields,
  attachments: Schema.optionalKey(
    Schema.Array(
      Schema.Union([
        Schema.Struct({ text: Schema.Struct({ content: Schema.String }) }),
        Schema.Struct({
          attachment_id: Schema.String,
          query: Schema.Struct({
            query: Schema.String,
            description: Schema.optionalKey(Schema.String),
          }),
        }),
        Schema.Struct({ suggested_questions: Schema.Unknown }),
        Schema.Struct({ viz: Schema.Unknown }),
      ]),
    ),
  ),
});
const Started = Schema.Struct({
  conversation_id: GenieOperation.fields.conversationId,
  message: Schema.Struct({ message_id: GenieOperation.fields.messageId }),
});
const Result = Schema.Struct({
  statement_response: Schema.Struct({
    manifest: Schema.optionalKey(
      Schema.Struct({
        truncated: Schema.optionalKey(Schema.Boolean),
        total_row_count: Schema.optionalKey(Schema.Number),
        schema: Schema.Struct({
          columns: Schema.Array(Schema.Struct({ name: Schema.String })),
        }),
      }),
    ),
    result: Schema.optionalKey(
      Schema.Struct({
        data_array: Schema.optionalKey(
          Schema.Array(Schema.Array(Schema.NullOr(Schema.String))),
        ),
      }),
    ),
  }),
});

export class Genie extends Context.Service<
  Genie,
  {
    readonly availability: Effect.Effect<CapabilityAvailability>;
    readonly submit: (
      input: typeof GenieInput.Type,
    ) => Effect.Effect<GenieOperation, ServiceError>;
    readonly poll: (
      operation: GenieOperation,
    ) => Effect.Effect<GenieProgress, ServiceError>;
    readonly result: (
      operation: GenieOperation,
    ) => Effect.Effect<GenieReply, ServiceError>;
  }
>()("app/Genie") {
  static readonly layer = Layer.effect(
    Genie,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const workspace = yield* Workspace;
      const capability = makeCapability(
        !!(settings.genieSpaceId && settings.host),
      );
      const admitSubmission = makeAdmission({
        service: "genie",
        concurrency: settings.genieConcurrency,
        timeout: "30 seconds",
      });
      const decode = <A>(schema: Schema.Decoder<A>, value: unknown) =>
        Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError(
            (cause) =>
              new UpstreamError({
                service: "genie",
                message:
                  "Genie returned an unexpected response. Retry retrieving this answer.",
                cause,
              }),
          ),
        );
      const configured = settings.genieSpaceId
        ? Effect.void
        : Effect.fail(
            unavailable(
              "genie",
              "Set GENIE_SPACE_ID to a Genie space over samples.nyctaxi.trips.",
            ),
          );
      const space = `/api/2.0/genie/spaces/${encodeURIComponent(settings.genieSpaceId)}`;
      const path = (operation: GenieOperation) =>
        `${space}/conversations/${encodeURIComponent(operation.conversationId)}/messages/${encodeURIComponent(operation.messageId)}`;
      const progress = (message: typeof MessageStatus.Type): GenieProgress => ({
        conversationId: message.conversation_id,
        messageId: message.message_id,
        status: message.status,
        state:
          message.status === "COMPLETED"
            ? "completed"
            : ["FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"].includes(
                  message.status,
                )
              ? "failed"
              : "pending",
      });
      const readMessage = <A>(
        operation: GenieOperation,
        schema: Schema.Decoder<A>,
      ) =>
        configured.pipe(
          Effect.andThen(workspace.request(path(operation))),
          Effect.flatMap((data) => decode(schema, data)),
        );
      const submit = (input: typeof GenieInput.Type) =>
        Effect.gen(function* () {
          yield* configured;
          if (input.conversationId) {
            const message = yield* workspace
              .request(
                `${space}/conversations/${encodeURIComponent(input.conversationId)}/messages`,
                "POST",
                { content: prompt(input) },
              )
              .pipe(Effect.flatMap((data) => decode(SubmittedMessage, data)));
            return {
              conversationId: message.conversation_id,
              messageId: message.message_id,
            };
          }
          const started = yield* workspace
            .request(`${space}/start-conversation`, "POST", {
              content: prompt(input),
            })
            .pipe(Effect.flatMap((data) => decode(Started, data)));
          return {
            conversationId: started.conversation_id,
            messageId: started.message.message_id,
          };
        }).pipe(
          admitSubmission,
          capability.track,
          Effect.withSpan("genie.submit"),
        );
      const poll = (operation: GenieOperation) =>
        readMessage(operation, MessageStatus).pipe(
          Effect.map(progress),
          capability.track,
          Effect.withSpan("genie.poll"),
        );
      const result = (operation: GenieOperation) =>
        Effect.gen(function* () {
          const message = yield* readMessage(operation, Message);
          if (message.status !== "COMPLETED")
            return yield* Effect.fail(
              new GenieFailed({
                status: message.status,
                message:
                  progress(message).state === "failed"
                    ? `Genie could not complete this question (${message.status}).`
                    : "This answer is still processing. Resume waiting for it.",
              }),
            );
          const queries = yield* Effect.forEach(
            (message.attachments ?? []).filter(
              (attachment) => "query" in attachment,
            ),
            (attachment) =>
              Effect.gen(function* () {
                const result = yield* workspace
                  .request(
                    `${path(operation)}/attachments/${encodeURIComponent(attachment.attachment_id)}/query-result`,
                  )
                  .pipe(Effect.flatMap((data) => decode(Result, data)));
                const statement = result.statement_response;
                const rows = statement.result?.data_array ?? [];
                return {
                  sql: attachment.query.query,
                  description: attachment.query.description ?? "Query result",
                  columns:
                    statement.manifest?.schema.columns.map(
                      (column) => column.name,
                    ) ?? [],
                  rows: rows.slice(0, 100),
                  truncated:
                    statement.manifest?.truncated === true ||
                    (statement.manifest?.total_row_count ?? rows.length) >
                      100 ||
                    (statement.manifest?.total_row_count ?? rows.length) >
                      rows.length,
                };
              }),
            { concurrency: 2 },
          );
          return {
            ...operation,
            text: (message.attachments ?? [])
              .flatMap((attachment) =>
                "text" in attachment ? [attachment.text.content] : [],
              )
              .join("\n\n"),
            queries,
          };
        }).pipe(
          Effect.timeoutOrElse({
            duration: "3 minutes",
            orElse: () =>
              Effect.fail(
                new OperationTimeout({
                  service: "genie",
                  message:
                    "Downloading the answer timed out. Retry retrieving this answer.",
                }),
              ),
          }),
          Effect.withSpan("genie.result"),
          capability.track,
        );
      return { availability: capability.availability, submit, poll, result };
    }),
  );
}
