import { Clock, Effect, Result, Schema, Stream } from "effect";
import { Subscription } from "foldkit";
import { type ApiClient, request } from "../../lib/api-client";
import { failure } from "../../lib/command-result";
import { Message as M, type Message, PollTarget } from "./messages";
import type { Model } from "./model";

const PollSelection = Schema.Struct({
  generation: Schema.Int,
  waiting: Schema.Array(PollTarget),
});

function poll(target: typeof PollTarget.Type, generation: number) {
  const complete = (outcome: ReturnType<typeof M.PolledQuestion>["outcome"]) =>
    M.PolledQuestion({ ...target, generation, outcome });
  const pause = (error: string) =>
    complete({ state: "paused", stage: "waiting", error });
  const read = request((client) =>
    client.pollGenie({
      params: target.operation,
      query: target.operation.mode ? { mode: target.operation.mode } : {},
    }),
  ).pipe(Effect.scoped, Effect.mapError(failure), Effect.result);
  return Stream.fromEffect(
    Effect.gen(function* () {
      const agent = target.operation.mode === "agent";
      const deadline =
        (yield* Clock.currentTimeMillis) + (agent ? 30 * 60_000 : 180_000);
      while (true) {
        const polled = yield* read;
        if (Result.isFailure(polled)) {
          const error = polled.failure;
          return typeof error !== "string"
            ? complete({ state: "failed", error })
            : pause(error);
        }
        const data = polled.success;
        if (data.state === "failed") {
          return complete({
            state: "failed",
            error: `Genie could not complete this question (${data.status}).`,
          });
        }
        if (data.state === "completed")
          return complete({ state: "retrieving" });
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          return pause(
            "Genie is taking longer than expected. Resume waiting for this answer.",
          );
        }
        yield* Effect.sleep(agent ? "5 seconds" : "1 second");
      }
    }),
  );
}

export const subscriptions = Subscription.make<Model, Message, ApiClient>()(
  (entry) => ({
    geniePoll: entry(PollSelection.fields, {
      modelToDependencies: (model) => ({
        generation: model.pollGeneration,
        waiting: model.turns.flatMap((turn) =>
          turn.state === "waiting"
            ? [{ id: turn.id, operation: turn.operation }]
            : [],
        ),
      }),
      // Each restored turn can finish while the others keep polling.
      keepAliveEquivalence: (left, right) =>
        left.generation === right.generation &&
        (left.waiting.length === 0) === (right.waiting.length === 0),
      dependenciesToStream: ({
        generation,
        waiting,
      }: typeof PollSelection.Type) =>
        Stream.mergeAll(
          waiting.map((turn) => poll(turn, generation)),
          {
            concurrency: "unbounded",
          },
        ),
    }),
  }),
);
