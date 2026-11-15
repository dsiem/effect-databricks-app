import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as D from "../../../../shared/domain";
import { request } from "../../lib/api-client";
import { result } from "../../lib/command-result";
import { Message as M } from "./messages";
export const LoadGps = Command.define("LoadGps", {
  args: { key: Schema.String, filters: D.Filters, endpoint: D.GpsEndpoint },
  messages: [M.LoadedGps],
  execute: ({ key, filters, endpoint }) =>
    result(
      request((client) =>
        client.gpsActivity({ query: { ...filters, endpoint } }),
      ),
    ).pipe(Effect.map((value) => M.LoadedGps({ key, ...value }))),
});
