import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NoteInput } from "../../../src/domain";
import { api, apiClient } from "../api";
import { FilterSummary } from "./explore-context";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "./ui";

export function NoteEditor({
  note,
  onClose,
  onSaved,
  onCloseAutoFocus,
  view = false,
}: {
  note: NoteInput;
  onClose: () => void;
  onSaved?: (title: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  view?: boolean;
}) {
  const [draft, setDraft] = useState(note);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api(
        apiClient.saveNote({
          payload: { ...draft, title: draft.title.trim() },
        }),
      ),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ["notes"] });
      onSaved?.(saved.title);
      onClose();
    },
    onError: () => void client.invalidateQueries({ queryKey: ["notes"] }),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {view
              ? note.version !== null
                ? "Edit saved view"
                : "Save this view"
              : note.version !== null
                ? "Edit note"
                : "New note"}
          </DialogTitle>
          <DialogDescription>
            {view
              ? "Give this view a name so you and your team can return to it."
              : "Save your findings with a snapshot of this Explore view."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            save.mutate();
          }}
          className="space-y-5"
        >
          <label htmlFor="note-title" className="block text-sm font-medium">
            {view ? "View name" : "Title"}
            <Input
              id="note-title"
              className="mt-2"
              autoFocus
              required
              maxLength={160}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={view ? "e.g. Midtown fare review" : "Analysis title"}
            />
          </label>
          <label htmlFor="note-body" className="block text-sm font-medium">
            {view ? "Finding (optional)" : "Your notes"}
            <Textarea
              id="note-body"
              className="mt-2 min-h-28"
              maxLength={10000}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="What is worth returning to? Add context or a next step…"
            />
          </label>
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-medium">
              {view ? "Applied filters" : "Saved Explore view"}
            </p>
            <FilterSummary filters={draft.filters} />
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {note.version !== null
                ? "This note keeps its original filters, even when your Explore view changes."
                : "These filters are saved with your note so you can reopen this view later."}
            </p>
          </div>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={save.isPending || !draft.title.trim()}
            >
              {save.isPending ? "Saving…" : view ? "Save view" : "Save note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
