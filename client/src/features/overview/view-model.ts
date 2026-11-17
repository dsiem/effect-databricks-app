import type { Filters } from "../../../../shared/domain";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly query: string;
  readonly filters: Filters;
  readonly mobile: boolean;
};
