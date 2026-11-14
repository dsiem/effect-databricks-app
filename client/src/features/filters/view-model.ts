import type { Dialog } from "@foldkit/ui";
import type * as D from "../../../../shared/domain";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly dialogs: { readonly calendar: Dialog.Model };
  readonly metadata: { readonly data: typeof D.Metadata.Type | null };
  readonly mobile: boolean;
};
