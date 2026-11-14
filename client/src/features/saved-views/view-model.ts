import type { Dialog } from "@foldkit/ui";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly dialogs: {
    readonly delete: Dialog.Model;
    readonly note: Dialog.Model;
    readonly views: Dialog.Model;
  };
};
