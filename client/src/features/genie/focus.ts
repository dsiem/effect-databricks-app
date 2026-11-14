import { Effect } from "effect";
import { Mount } from "foldkit";
import { Idle } from "../../lib/idle";

// The desktop assistant is a persistent non-modal panel, rather than a modal Dialog.
export const PanelReturnFocus = Mount.define("PanelReturnFocus", {
  messages: [Idle],
  execute: () =>
    Effect.acquireRelease(
      Effect.sync(() =>
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      ),
      (opener) =>
        Effect.sync(() => {
          if (opener?.isConnected) opener.focus();
          else document.querySelector<HTMLElement>("#genie-trigger")?.focus();
        }),
    ).pipe(Effect.as(Idle())),
});
