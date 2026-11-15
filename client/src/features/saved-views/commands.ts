import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as D from "../../../../shared/domain";
import { request } from "../../lib/api-client";
import { result } from "../../lib/command-result";
import { randomUuid } from "../../lib/uuid";
import { Message as M } from "./messages";
export const NewSavedView = Command.define("CreateSavedViewDraft", {
  args: {},
  messages: [M.CreatedSavedView],
  execute: () => Effect.sync(() => M.CreatedSavedView({ id: randomUuid() })),
});
export const SaveSavedView = Command.define("SaveSavedView", {
  args: { draft: D.SavedViewInput },
  messages: [M.SavedViewSaved],
  execute: ({ draft }) =>
    result(
      request((client) =>
        client.saveSavedView({
          payload: { ...draft, title: draft.title.trim() },
        }),
      ),
    ).pipe(
      Effect.map(({ data, error }) =>
        M.SavedViewSaved({ savedView: data, error }),
      ),
    ),
});
export const LoadSavedViews = Command.define("LoadSavedViews", {
  args: {
    cursor: Schema.NullOr(D.SavedViewCursor),
    pages: Schema.Number,
    more: Schema.Boolean,
  },
  messages: [M.LoadedSavedViews],
  execute: ({ cursor, pages, more }) =>
    result(
      Effect.gen(function* () {
        let next = cursor;
        const rows: D.SavedView[] = [];
        for (let page = 0; page < pages; page++) {
          const response = yield* request((client) =>
            client.savedViews({
              query: next ? { cursor: next } : {},
            }),
          );
          rows.push(...response.rows);
          next = response.nextCursor;
          if (!next) break;
        }
        return { rows, nextCursor: next };
      }),
    ).pipe(
      Effect.map((value) => M.LoadedSavedViews({ ...value, more, pages })),
    ),
});
export const PinSavedView = Command.define("PinSavedView", {
  args: { savedView: D.SavedView },
  messages: [M.MutatedSavedView],
  execute: ({ savedView }) =>
    result(
      request((client) =>
        client.pinSavedView({
          params: { id: savedView.id },
          payload: { pinned: !savedView.pinned, version: savedView.version },
        }),
      ),
    ).pipe(
      Effect.map(({ error }) => M.MutatedSavedView({ error, removed: false })),
    ),
});
export const DeleteSavedView = Command.define("DeleteSavedView", {
  args: { savedView: D.SavedView },
  messages: [M.MutatedSavedView],
  execute: ({ savedView }) =>
    result(
      request((client) =>
        client.removeSavedView({
          params: { id: savedView.id },
          query: { version: savedView.version },
        }),
      ),
    ).pipe(
      Effect.map(({ error }) => M.MutatedSavedView({ error, removed: true })),
    ),
});
