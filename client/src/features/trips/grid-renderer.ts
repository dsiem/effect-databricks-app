import { Effect, Queue, Schema, Stream, SubscriptionRef } from "effect";
import type { Mount } from "foldkit";
import { createGridDom } from "./grid-dom";
import type { GridEvent } from "./grid-mount";
import {
  type GridInput,
  type WorkerRequest,
  WorkerResponse,
} from "./grid-protocol";

export function mountTripGrid(
  element: HTMLElement,
  inputs: SubscriptionRef.SubscriptionRef<GridInput>,
  viewStates: Stream.Stream<Mount.ViewState>,
  queue: Queue.Enqueue<GridEvent>,
) {
  return Effect.gen(function* () {
    const renderer = yield* Effect.acquireRelease(
      Effect.try(() => {
        const createWorker = () =>
          new Worker(new URL("./dataset.worker.ts", import.meta.url), {
            type: "module",
          });
        let worker: Worker | undefined = createWorker();
        let disposed = false;
        const stop = () => {
          if (!worker) return;
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", fail);
          worker.removeEventListener("messageerror", fail);
          worker.terminate();
          worker = undefined;
        };
        const fail = () => {
          stop();
          dom.fail();
        };
        const onMessage = (event: MessageEvent<unknown>) => {
          const decoded = Schema.decodeUnknownOption(WorkerResponse)(
            event.data,
          );
          if (decoded._tag === "Some") dom.receive(decoded.value);
          else fail();
        };
        const listen = (next: Worker) => {
          next.addEventListener("message", onMessage);
          next.addEventListener("error", fail);
          next.addEventListener("messageerror", fail);
        };
        const send = (message: WorkerRequest) => {
          if (disposed) return;
          try {
            if (!worker && message.type === "query") {
              worker = createWorker();
              listen(worker);
            }
            worker?.postMessage(message);
          } catch {
            fail();
          }
        };
        const dom = (() => {
          let mounted: ReturnType<typeof createGridDom> | undefined;
          try {
            mounted = createGridDom(element, {
              send,
              publish: (event) => Queue.offerUnsafe(queue, event),
            });
            listen(worker);
            return mounted;
          } catch (error) {
            stop();
            mounted?.dispose();
            throw error;
          }
        })();
        return {
          update: dom.update,
          dispose() {
            if (disposed) return;
            disposed = true;
            stop();
            dom.dispose();
          },
        };
      }),
      (renderer) => Effect.sync(() => renderer.dispose()),
    );
    yield* Stream.runForEach(SubscriptionRef.changes(inputs), (input) =>
      Effect.sync(() => renderer.update(input)),
    ).pipe(Effect.forkScoped);
    yield* Stream.runForEach(viewStates, (state) =>
      Effect.sync(() => {
        element.inert = state !== "Live";
      }),
    ).pipe(Effect.forkScoped);
    yield* Effect.never;
  }).pipe(
    Effect.mapError(() => "Unable to mount the trip grid. Reload to retry."),
  );
}
