import { Effect, Queue, Schema, Stream, SubscriptionRef } from "effect";
import { Command, Mount } from "foldkit";
import * as D from "../../../../shared/domain";
import { done } from "../../lib/command-result";
import { parseGeography } from "./geography";
import { Message as M } from "./view-messages";

export const mapHostId = "pickup-map";
const MapData = Schema.Struct({
  zones: Schema.Array(D.Zone),
  query: Schema.String,
  loading: Schema.Boolean,
});
export type MapData = typeof MapData.Type;
export type MapEvent =
  | ReturnType<typeof M.MapReady>
  | ReturnType<typeof M.SelectZip>;

// Commands publish to the active host. Replaying the latest input also covers
// filter changes made before the renderer's asynchronous setup has finished.
const inputsByHost = new WeakMap<
  Element,
  SubscriptionRef.SubscriptionRef<MapData>
>();

export const RefreshMap = Command.define("RefreshPickupMap", {
  args: MapData.fields,
  messages: [M.Idle],
  execute: (data) =>
    done(
      Effect.gen(function* () {
        const element = document.getElementById(mapHostId);
        const inputs = element && inputsByHost.get(element);
        if (inputs) yield* SubscriptionRef.set(inputs, data);
      }),
    ),
});

export const MapMount = Mount.defineStream("PickupMap", {
  args: MapData.fields,
  messages: [M.MapReady, M.SelectZip],
  execute: ({ element, viewStateChanges, ...initialData }) =>
    Stream.callback<MapEvent>((queue) =>
      Effect.gen(function* () {
        const inputs = yield* SubscriptionRef.make<MapData>(initialData);
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            inputsByHost.set(element, inputs);
            return inputs;
          }),
          (owned) =>
            Effect.sync(() => {
              if (inputsByHost.get(element) === owned)
                inputsByHost.delete(element);
            }),
        );
        yield* Effect.gen(function* () {
          if (!(element instanceof HTMLElement))
            return yield* Effect.fail(
              "The pickup map container is unavailable. Try again.",
            );
          const [renderer, geography] = yield* Effect.all([
            Effect.tryPromise({
              try: () => import("./renderer"),
              catch: () => "Unable to load the pickup map. Try again.",
            }),
            Effect.tryPromise({
              try: async (signal) => {
                const response = await fetch("/nyc-zips.geojson", { signal });
                if (!response.ok)
                  throw new Error("Unable to load NYC boundaries");
                return parseGeography(await response.json());
              },
              catch: () =>
                "Unable to load NYC geographic boundaries. Try again.",
            }),
          ]);
          yield* renderer.mountPickupMap(
            element,
            geography,
            inputs,
            viewStateChanges,
            queue,
          );
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const { query } = yield* SubscriptionRef.get(inputs);
              Queue.offerUnsafe(
                queue,
                M.MapReady({
                  query,
                  mapped: 0,
                  error,
                }),
              );
            }),
          ),
        );
      }),
    ),
});
