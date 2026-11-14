import type { Model as OverviewModel } from "../overview/model";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly overview: OverviewModel["overview"];
  readonly query: string;
};
