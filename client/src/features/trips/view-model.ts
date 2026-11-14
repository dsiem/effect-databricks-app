import type { Dialog } from "@foldkit/ui";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly dialogs: { readonly trip: Dialog.Model };
};
