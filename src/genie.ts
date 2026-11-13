import { Context, Effect, Layer, Schema } from "effect";
import {
  type AppError,
  type GenieInput,
  type GenieReply,
  unavailable,
} from "./domain.js";
import { Settings } from "./settings.js";
import { Workspace } from "./workspace.js";

const Message = Schema.Struct({
  message_id: Schema.String,
  conversation_id: Schema.String,
  status: Schema.String,
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
  conversation_id: Schema.String,
  message: Message,
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
    readonly ask: (
      input: typeof GenieInput.Type,
    ) => Effect.Effect<GenieReply, AppError>;
  }
>()("app/Genie") {
  static readonly layer = Layer.effect(
    Genie,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const workspace = yield* Workspace;
      const failure = unavailable(
        "genie",
        "Genie could not complete this question. Check the space configuration and permissions, then retry.",
      );
      const decode = <A>(schema: Schema.Decoder<A>, value: unknown) =>
        Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError(() => failure),
        );
      const space = `/api/2.0/genie/spaces/${encodeURIComponent(settings.genieSpaceId)}`;
      const ask = (input: typeof GenieInput.Type) =>
        Effect.gen(function* () {
          if (!settings.genieSpaceId)
            return yield* Effect.fail(
              unavailable(
                "genie",
                "Set GENIE_SPACE_ID to a Genie space over samples.nyctaxi.trips.",
              ),
            );
          let message: typeof Message.Type;
          if (input.conversationId) {
            message = yield* workspace
              .request(
                `${space}/conversations/${encodeURIComponent(input.conversationId)}/messages`,
                "POST",
                { content: input.content },
              )
              .pipe(Effect.flatMap((data) => decode(Message, data)));
          } else {
            const started = yield* workspace
              .request(`${space}/start-conversation`, "POST", {
                content: input.content,
              })
              .pipe(Effect.flatMap((data) => decode(Started, data)));
            message = started.message;
          }
          const path = `${space}/conversations/${encodeURIComponent(message.conversation_id)}/messages/${encodeURIComponent(message.message_id)}`;
          while (message.status !== "COMPLETED") {
            if (
              ["FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"].includes(
                message.status,
              )
            )
              return yield* Effect.fail(failure);
            yield* Effect.sleep("1 second");
            message = yield* workspace
              .request(path)
              .pipe(Effect.flatMap((data) => decode(Message, data)));
          }
          const queries = yield* Effect.forEach(
            (message.attachments ?? []).filter(
              (attachment) => "query" in attachment,
            ),
            (attachment) =>
              Effect.gen(function* () {
                const result = yield* workspace
                  .request(
                    `${path}/attachments/${encodeURIComponent(attachment.attachment_id)}/query-result`,
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
            conversationId: message.conversation_id,
            messageId: message.message_id,
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
                unavailable(
                  "genie",
                  "Genie is taking longer than expected. Start a new conversation and try again.",
                ),
              ),
          }),
          Effect.withSpan("genie.ask"),
        );
      return { ask };
    }),
  );
}
