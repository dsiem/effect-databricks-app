import { Data, Effect, Schema, Stream } from "effect";
import type { GenieOperation } from "./index.js";
import { GenieId } from "./protocol.js";

export interface GenieQueryReference extends GenieOperation {
  readonly attachmentId: string;
}

export type GenieDownloadRequest =
  | { readonly kind: "start"; readonly method: "POST"; readonly path: string }
  | {
      readonly kind: "poll" | "chunk";
      readonly method: "GET";
      readonly path: string;
    };

export class GenieDownloadError extends Data.TaggedError("GenieDownloadError")<{
  readonly message: string;
}> {}

const Download = Schema.Struct({
  download_id: GenieId,
  download_id_signature: Schema.NonEmptyString,
});

const Chunk = Schema.Struct({
  chunk_index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  external_link: Schema.NonEmptyString,
  http_headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const ChunkResult = Schema.Struct({
  external_links: Schema.Array(Chunk),
});

const Statement = Schema.Struct({
  statement_response: Schema.Struct({
    status: Schema.Struct({ state: Schema.String }),
    statement_id: Schema.optionalKey(GenieId),
    manifest: Schema.optionalKey(
      Schema.Struct({
        format: Schema.Literal("CSV"),
        truncated: Schema.Boolean,
        total_chunk_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        schema: Schema.Struct({
          columns: Schema.Array(Schema.Struct({ name: Schema.String })),
        }),
      }),
    ),
    result: Schema.optionalKey(ChunkResult),
  }),
});

const decode = <A>(schema: Schema.Decoder<A>, data: unknown) =>
  Schema.decodeUnknownEffect(schema)(data).pipe(
    Effect.mapError(
      () =>
        new GenieDownloadError({
          message: "Genie returned invalid CSV download details.",
        }),
    ),
  );

const cloudStorage = (hostname: string) =>
  /(?:^|\.)s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?$/.test(hostname) ||
  /\.blob\.core\.(?:windows\.net|usgovcloudapi\.net|chinacloudapi\.cn)$/.test(
    hostname,
  ) ||
  hostname === "storage.googleapis.com" ||
  hostname.endsWith(".storage.googleapis.com") ||
  /^[a-z0-9-]+\.storage\.cloud\.databricks\.com$/.test(hostname);

export const makeGenieDownloadClient = <E, R>(options: {
  readonly spaceId: string;
  readonly request: (
    request: GenieDownloadRequest,
  ) => Effect.Effect<unknown, E, R>;
  readonly fetch?: typeof globalThis.fetch;
  readonly allowDatabricksStorageProxy?: boolean;
}) => {
  const fetch = options.fetch ?? globalThis.fetch;
  const request = options.request;
  const space = `/api/2.0/genie/spaces/${encodeURIComponent(options.spaceId)}`;

  const storageUrl = (link: string) =>
    Effect.try({
      try: () => {
        const url = new URL(link);
        const managedProxy =
          options.allowDatabricksStorageProxy &&
          url.hostname === "storage-proxy.databricks.com" &&
          url.protocol === "http:";
        if (
          (!managedProxy &&
            (url.protocol !== "https:" || !cloudStorage(url.hostname))) ||
          url.port ||
          url.username ||
          url.password ||
          url.hash
        )
          throw new Error();
        return url;
      },
      catch: () =>
        new GenieDownloadError({
          message: "Genie returned an unrecognized CSV storage location.",
        }),
    });

  const storageError = (status?: number) =>
    new GenieDownloadError({
      message:
        status === undefined
          ? "Could not read the Genie CSV from storage."
          : `Genie CSV storage returned HTTP ${status}.`,
    });

  const readChunk = (chunk: typeof Chunk.Type) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const url = yield* storageUrl(chunk.external_link);
        const headers = Object.fromEntries(
          Object.entries(chunk.http_headers ?? {}).filter(([name]) =>
            /^x-(?:amz|ms|goog)-/i.test(name),
          ),
        );
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(url, {
              credentials: "omit",
              redirect: "error",
              signal,
              headers,
            }),
          catch: () => storageError(),
        }).pipe(
          Effect.timeoutOrElse({
            duration: "30 seconds",
            orElse: () => Effect.fail(storageError()),
          }),
        );
        if (response.status !== 200) {
          yield* Effect.promise(
            () =>
              response.body?.cancel().catch(() => undefined) ??
              Promise.resolve(),
          );
          return yield* storageError(response.status);
        }
        const body = response.body;
        if (!body) return yield* storageError();
        return Stream.fromReadableStream({
          evaluate: () => body,
          onError: () => storageError(),
        });
      }),
    );

  const download = (reference: GenieQueryReference) =>
    Effect.gen(function* () {
      const path = `${space}/conversations/${encodeURIComponent(reference.conversationId)}/messages/${encodeURIComponent(reference.messageId)}/attachments/${encodeURIComponent(reference.attachmentId)}/downloads`;
      const started = yield* request({
        kind: "start",
        method: "POST",
        path,
      }).pipe(Effect.flatMap((data) => decode(Download, data)));
      const pollPath = `${path}/${encodeURIComponent(started.download_id)}?${new URLSearchParams({ download_id_signature: started.download_id_signature }).toString()}`;
      const poll = request({
        kind: "poll",
        method: "GET",
        path: pollPath,
      }).pipe(
        Effect.flatMap((data) => decode(Statement, data)),
        Effect.map((data) => data.statement_response),
      );
      let statement = yield* poll;
      while (["PENDING", "RUNNING"].includes(statement.status.state)) {
        yield* Effect.sleep("2 seconds");
        statement = yield* poll;
      }

      const manifest = statement.manifest;
      if (
        statement.status.state !== "SUCCEEDED" ||
        !statement.statement_id ||
        !manifest
      )
        return yield* new GenieDownloadError({
          message: "Genie could not prepare the full CSV.",
        });
      if (manifest.truncated)
        return yield* new GenieDownloadError({
          message:
            "Databricks truncated the CSV. Narrow the query and try again.",
        });

      const statementId = statement.statement_id;
      const links = new Map(
        (statement.result?.external_links ?? []).map((chunk) => [
          chunk.chunk_index,
          chunk,
        ]),
      );
      const readLink = (index: number) =>
        Effect.gen(function* () {
          const link = links.get(index);
          if (link !== undefined) return link;
          const data = yield* request({
            kind: "chunk",
            method: "GET",
            path: `/api/2.0/sql/statements/${encodeURIComponent(statementId)}/result/chunks/${index}`,
          });
          const chunk = (yield* decode(ChunkResult, data)).external_links.find(
            (chunk) => chunk.chunk_index === index,
          );
          if (!chunk)
            return yield* new GenieDownloadError({
              message: "Genie omitted a CSV result chunk.",
            });
          return chunk;
        });

      if (manifest.total_chunk_count === 0) {
        const header = manifest.schema.columns
          .map(({ name }) => `"${name.replaceAll('"', '""')}"`)
          .join(",");
        return Stream.make(new TextEncoder().encode(`${header}\r\n`));
      }

      return Stream.suspend(() => {
        // Databricks writes column names in the first chunk. Subsequent chunks
        // start at a row boundary, but a chunk may omit its final line break.
        let endsWithNewline = true;
        return Stream.range(0, manifest.total_chunk_count - 1).pipe(
          Stream.flatMap((index) =>
            Stream.unwrap(
              readLink(index).pipe(
                Effect.map((chunk) => {
                  const prefix = endsWithNewline
                    ? Stream.empty
                    : Stream.make(new TextEncoder().encode("\r\n"));
                  return Stream.concat(prefix, readChunk(chunk)).pipe(
                    Stream.tap((bytes) =>
                      Effect.sync(() => {
                        if (bytes.length > 0)
                          endsWithNewline = bytes.at(-1) === 10;
                      }),
                    ),
                  );
                }),
              ),
            ),
          ),
        );
      });
    });
  return { download };
};
