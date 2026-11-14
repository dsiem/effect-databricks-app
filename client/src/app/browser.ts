import { Effect, Queue, Stream } from "effect";
import { Subscription } from "foldkit";
import { Message as M, type Message } from "./message";
import type { Model } from "./model";

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  browser: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.callback<Message>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const keydown = (event: KeyboardEvent) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key.toLowerCase() === "b"
                ) {
                  event.preventDefault();
                  Queue.offerUnsafe(queue, M.ToggleSidebar());
                }
              };
              const media = matchMedia("(max-width: 767px)");
              const resize = () =>
                Queue.offerUnsafe(queue, M.Resized({ mobile: media.matches }));
              window.addEventListener("keydown", keydown);
              media.addEventListener("change", resize);
              return () => {
                window.removeEventListener("keydown", keydown);
                media.removeEventListener("change", resize);
              };
            }),
            (cleanup) => Effect.sync(cleanup),
          ),
        ),
    },
  ),
}));
