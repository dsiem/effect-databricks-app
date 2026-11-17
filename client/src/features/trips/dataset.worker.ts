import { Effect, Schema, type Scope } from "effect";
import { ApiClient, request } from "../../lib/api-client";
import { createDatasetSession } from "./dataset-session";
import { WorkerRequest } from "./grid-protocol";

const run = <A, E>(
  effect: Effect.Effect<A, E, ApiClient | Scope.Scope>,
  signal: AbortSignal,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ApiClient.layer), Effect.scoped),
    { signal },
  );
const session = createDatasetSession({
  api: {
    dataset: (query, signal) =>
      run(
        request((client) => client.tripDataset({ payload: query })),
        signal,
      ),
    window: (query, cursor, signal) =>
      run(
        request((client) => client.tripWindow({ payload: { query, cursor } })),
        signal,
      ),
    detail: (tripId, snapshot, signal) =>
      run(
        request((client) =>
          client.tripDetail({ payload: { tripId, snapshot } }),
        ),
        signal,
      ),
    counts: (tripIds, signal) =>
      run(
        request((client) => client.tripCommentCounts({ query: { tripIds } })),
        signal,
      ),
  },
  emit: (message) => postMessage(message),
});
addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = Schema.decodeUnknownOption(WorkerRequest)(event.data);
  if (parsed._tag === "Some") void session.receive(parsed.value);
  else session.invalidRequest();
});
