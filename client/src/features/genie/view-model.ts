import type { Dialog } from "@foldkit/ui";
import type * as D from "../../../../shared/domain";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly dialogs: { readonly genie: Dialog.Model };
  readonly mobile: boolean;
  readonly query: string;
  readonly context: D.GenieContext;
  readonly status: {
    readonly data: typeof D.Status.Type | null;
    readonly loading: boolean;
    readonly error: string;
  };
};
