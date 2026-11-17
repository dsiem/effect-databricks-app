import { Effect, Queue, Stream, SubscriptionRef } from "effect";
import { Command, Mount } from "foldkit";
import { done } from "../../lib/command-result";
import { GridInput } from "./grid-protocol";
import { Message as M } from "./messages";

export const gridHostId = "trip-virtual-grid";
export type GridEvent =
  | ReturnType<typeof M.TripGridStatus>
  | ReturnType<typeof M.TripGridSelected>
  | ReturnType<typeof M.TripGridWindow>;
const inputsByHost = new WeakMap<
  Element,
  SubscriptionRef.SubscriptionRef<GridInput>
>();
export const RefreshTripGrid = Command.define("RefreshTripGrid", {
  args: GridInput.fields,
  messages: [M.Idle],
  execute: (input) =>
    done(
      Effect.gen(function* () {
        const host = document.getElementById(gridHostId);
        const inputs = host && inputsByHost.get(host);
        if (inputs) yield* SubscriptionRef.set(inputs, input);
      }),
    ),
});
export const TripGridMount = Mount.defineStream("TripGrid", {
  args: GridInput.fields,
  messages: [M.TripGridStatus, M.TripGridSelected, M.TripGridWindow],
  execute: ({ element, viewStateChanges, ...initial }) =>
    Stream.callback<GridEvent>((queue) =>
      Effect.gen(function* () {
        const inputs = yield* SubscriptionRef.make<GridInput>(initial);
        yield* Effect.acquireRelease(
          Effect.sync(() => inputsByHost.set(element, inputs)),
          () => Effect.sync(() => inputsByHost.delete(element)),
        );
        yield* Effect.gen(function* () {
          if (!(element instanceof HTMLElement))
            return yield* Effect.fail("The grid container is unavailable.");
          const renderer = yield* Effect.tryPromise({
            try: () => import("./grid-renderer"),
            catch: () => "Unable to load the trip grid. Reload to retry.",
          });
          yield* renderer.mountTripGrid(
            element,
            inputs,
            viewStateChanges,
            queue,
          );
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const { key } = yield* SubscriptionRef.get(inputs);
              Queue.offerUnsafe(
                queue,
                M.TripGridStatus({
                  key,
                  loading: false,
                  error,
                  scope: "none",
                  total: 0,
                  loaded: 0,
                }),
              );
            }),
          ),
        );
      }),
    ),
});
