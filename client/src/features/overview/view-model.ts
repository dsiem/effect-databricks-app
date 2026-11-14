import type { Model } from "./model";
export type ViewModel = Model & {
  readonly query: string;
  readonly mobile: boolean;
};
