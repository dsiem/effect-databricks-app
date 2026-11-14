import { Schema } from "effect";
import * as D from "../../../../shared/domain";

export const messages = {
  LoadedOverview: {
    key: Schema.String,
    data: Schema.NullOr(D.Overview),
    error: Schema.String,
  },
};
