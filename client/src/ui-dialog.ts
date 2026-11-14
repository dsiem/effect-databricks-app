import { Dialog } from "@foldkit/ui";
import { Message as M } from "./message";
import type { Model } from "./model";
import type { Child, H } from "./ui";
import type { DialogId } from "./ui-state";

export function dialog(
  h: H,
  model: Model,
  id: DialogId,
  classes: string,
  children: Child[],
) {
  return h.submodel({
    slotId: `dialog-${id}`,
    view: Dialog.view,
    model: model.dialogs[id],
    toParentMessage: (message) => M.Dialog({ id, message }),
    viewInputs: {
      toView: ({ dialog, backdrop, panel, title, isVisible }) =>
        h.dialog(
          [...dialog, h.Class("modal-host")],
          isVisible
            ? [
                h.div([...backdrop, h.Class("modal-backdrop")], []),
                h.div(
                  [...panel, h.Class(classes)],
                  [
                    ...(id === "navigation"
                      ? [h.h2([...title, h.Class("sr-only")], ["Sidebar"])]
                      : []),
                    ...children,
                  ],
                ),
              ]
            : [],
        ),
    },
  });
}
