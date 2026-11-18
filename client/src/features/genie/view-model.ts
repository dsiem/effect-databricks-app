import type * as D from "../../../../shared/domain";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly mobile: boolean;
  readonly filters: D.Filters | null;
  readonly context: D.GenieContext;
};
