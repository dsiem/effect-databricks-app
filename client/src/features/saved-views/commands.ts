import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as D from "../../../../shared/domain";
import { request } from "../../lib/api-client";
import { result } from "../../lib/command-result";
import { randomUuid } from "../../lib/uuid";
import { Message as M } from "./messages";
export const NewNote = Command.define("CreateNoteDraft", {
  args: {},
  messages: [M.CreatedNote],
  execute: () => Effect.sync(() => M.CreatedNote({ id: randomUuid() })),
});
export const SaveNote = Command.define("SaveNote", {
  args: { draft: D.NoteInput },
  messages: [M.SavedNote],
  execute: ({ draft }) =>
    result(
      request((client) =>
        client.saveNote({ payload: { ...draft, title: draft.title.trim() } }),
      ),
    ).pipe(Effect.map(({ data, error }) => M.SavedNote({ note: data, error }))),
});
export const LoadNotes = Command.define("LoadNotes", {
  args: {
    cursor: Schema.NullOr(D.NoteCursor),
    pages: Schema.Number,
    more: Schema.Boolean,
  },
  messages: [M.LoadedNotes],
  execute: ({ cursor, pages, more }) =>
    result(
      Effect.gen(function* () {
        let next = cursor;
        const rows: D.Note[] = [];
        for (let page = 0; page < pages; page++) {
          const response = yield* request((client) =>
            client.notes({
              query: next ? { cursor: next } : {},
            }),
          );
          rows.push(...response.rows);
          next = response.nextCursor;
          if (!next) break;
        }
        return { rows, nextCursor: next };
      }),
    ).pipe(Effect.map((value) => M.LoadedNotes({ ...value, more, pages }))),
});
export const PinNote = Command.define("PinNote", {
  args: { note: D.Note },
  messages: [M.MutatedNote],
  execute: ({ note }) =>
    result(
      request((client) =>
        client.pinNote({
          params: { id: note.id },
          payload: { pinned: !note.pinned, version: note.version },
        }),
      ),
    ).pipe(Effect.map(({ error }) => M.MutatedNote({ error, removed: false }))),
});
export const DeleteNote = Command.define("DeleteNote", {
  args: { note: D.Note },
  messages: [M.MutatedNote],
  execute: ({ note }) =>
    result(
      request((client) =>
        client.removeNote({
          params: { id: note.id },
          query: { version: note.version },
        }),
      ),
    ).pipe(Effect.map(({ error }) => M.MutatedNote({ error, removed: true }))),
});
