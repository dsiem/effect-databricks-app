import type * as D from "../../../../shared/domain";
import type { RequestState } from "../../lib/request-state";
import type { Model } from "./model";
export type ViewModel = Model & {
  readonly overview: RequestState<typeof D.Overview>;
  readonly query: string;
};
