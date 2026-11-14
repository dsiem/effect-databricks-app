import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as D from "../../../../shared/domain";
import { Message as M } from "../../app/message";
import { request } from "../../lib/api-client";

import { result } from "../../lib/command-result";
export const LoadOverview = Command.define("LoadOverview", {
  args: { key: Schema.String, filters: D.Filters },
  messages: [M.LoadedOverview],
  execute: ({ key, filters }) =>
    result(request((client) => client.overview({ query: filters }))).pipe(
      Effect.map((value) => M.LoadedOverview({ key, ...value })),
    ),
});
