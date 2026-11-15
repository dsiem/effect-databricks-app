import { Dialog } from "@foldkit/ui";

/** Domain state decides visibility; Foldkit owns resource acquisition and release. */
export const syncDialog = (model: Dialog.Model, visible: boolean) =>
  visible === model.isOpen
    ? { model, commands: [] }
    : visible
      ? Dialog.open(model)
      : Dialog.close(model);
