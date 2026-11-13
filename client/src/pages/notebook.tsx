import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ExternalLink,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Note, NoteInput } from "../../../src/domain";
import { api, apiClient, useFilters } from "../api";
import { ErrorState, Loading, PageTitle } from "../components/common";
import { ExploreContext, FilterSummary } from "../components/explore-context";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "../components/ui";
export default function Notebook() {
  const { filters } = useFilters();
  const client = useQueryClient();
  const navigate = useNavigate();
  const notes = useQuery({
    queryKey: ["notes"],
    queryFn: ({ signal }) => api(apiClient.notes(), signal),
    staleTime: 0,
  });
  const [editing, setEditing] = useState<NoteInput | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const newNoteButton = useRef<HTMLButtonElement>(null);
  const restoreDialogFocus = (event: Event) => {
    event.preventDefault();
    (dialogTrigger.current?.isConnected
      ? dialogTrigger.current
      : newNoteButton.current
    )?.focus();
  };
  const save = useMutation({
    mutationFn: (note: NoteInput) => api(apiClient.saveNote({ payload: note })),
    onSuccess: () => {
      setEditing(null);
      void client.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: () => void client.invalidateQueries({ queryKey: ["notes"] }),
  });
  const pin = useMutation({
    mutationFn: (note: Note) =>
      api(
        apiClient.pinNote({
          params: { id: note.id },
          payload: { version: note.version, pinned: !note.pinned },
        }),
      ),
    onSettled: () => void client.invalidateQueries({ queryKey: ["notes"] }),
  });
  const remove = useMutation({
    mutationFn: (note: Note) =>
      api(
        apiClient.removeNote({
          params: { id: note.id },
          query: { version: note.version },
        }),
      ),
    onSuccess: () => {
      setDeleting(null);
      void client.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: () => void client.invalidateQueries({ queryKey: ["notes"] }),
  });
  const open = (note: NoteInput) => {
    dialogTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    save.reset();
    setEditing({
      id: note.id,
      title: note.title,
      body: note.body,
      filters: note.filters,
      version: note.version,
    });
  };
  return (
    <>
      <PageTitle
        title="Analyst notebook"
        description="Capture findings and reopen the Explore view behind each note."
        action={
          <Button
            ref={newNoteButton}
            onClick={() =>
              open({
                id: crypto.randomUUID(),
                title: "",
                body: "",
                filters,
                version: null,
              })
            }
          >
            <Plus />
            New note
          </Button>
        }
      />
      <div className="mb-6">
        <ExploreContext purpose="note" />
      </div>
      {notes.isPending ? (
        <Loading text="Loading saved notes…" />
      ) : notes.error ? (
        <ErrorState error={notes.error} retry={() => void notes.refetch()} />
      ) : !notes.data.length ? (
        <Card className="flex min-h-80 flex-col gap-0 items-center justify-center p-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted">
            <BookOpen className="size-6 text-primary" />
          </span>
          <h2 className="mt-5 text-lg font-semibold">No saved notes</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Create a note to save your findings and the Explore view shown
            above.
          </p>
          <Button
            className="mt-6"
            onClick={() =>
              open({
                id: crypto.randomUUID(),
                title: "",
                body: "",
                filters,
                version: null,
              })
            }
          >
            <Plus />
            Create note
          </Button>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {notes.data.length} saved{" "}
            {notes.data.length === 1 ? "note" : "notes"} · shared across this
            app
          </p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {notes.data.map((note) => (
              <Card key={note.id} className="gap-0 p-6">
                <div className="mb-4 flex items-start gap-3">
                  <h2 className="flex-1 text-base font-semibold tracking-tight">
                    {note.title}
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      note.pinned ? `Unpin ${note.title}` : `Pin ${note.title}`
                    }
                    type="button"
                    disabled={pin.isPending}
                    onClick={() => pin.mutate(note)}
                  >
                    <Pin
                      className={`size-4 ${note.pinned ? "fill-primary text-primary" : "text-muted-foreground"}`}
                    />
                  </Button>
                </div>
                <p className="mb-5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {note.body || "No additional details."}
                </p>
                <div className="mt-auto">
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Saved Explore view
                    </p>
                    <FilterSummary filters={note.filters} />
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-3 h-auto p-0"
                      aria-label={`Open saved view for ${note.title}`}
                      onClick={() =>
                        navigate(
                          `/?${new URLSearchParams(Object.entries(note.filters))}`,
                        )
                      }
                    >
                      Open saved view
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between border-t pt-4">
                    <span className="text-xs text-muted-foreground">
                      Updated {new Date(note.updated_at).toLocaleDateString()}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${note.title}`}
                        onClick={() => open(note)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${note.title}`}
                        onClick={() => {
                          dialogTrigger.current =
                            document.activeElement instanceof HTMLElement
                              ? document.activeElement
                              : null;
                          remove.reset();
                          setDeleting(note);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {pin.error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {pin.error.message}
            </p>
          )}
        </>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setEditing(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={restoreDialogFocus}
        >
          <DialogHeader>
            <DialogTitle>
              {editing?.version !== null ? "Edit note" : "New note"}
            </DialogTitle>
            <DialogDescription>
              Save your findings with a snapshot of this Explore view.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate({ ...editing, title: editing.title.trim() });
              }}
              className="space-y-5"
            >
              <label htmlFor="note-title" className="block text-sm font-medium">
                Title
                <Input
                  id="note-title"
                  className="mt-2"
                  autoFocus
                  required
                  maxLength={160}
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                  placeholder="Analysis title"
                />
              </label>
              <label htmlFor="note-body" className="block text-sm font-medium">
                Your notes
                <Textarea
                  id="note-body"
                  className="mt-2"
                  maxLength={10000}
                  value={editing.body}
                  onChange={(e) =>
                    setEditing({ ...editing, body: e.target.value })
                  }
                  placeholder="Add context, a question, or a next step…"
                />
              </label>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="mb-2 text-sm font-medium">Saved Explore view</p>
                <FilterSummary filters={editing.filters} />
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {editing.version !== null
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
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={save.isPending || !editing.title.trim()}
                >
                  {save.isPending ? "Saving…" : "Save note"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreDialogFocus}>
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
            <DialogDescription>{`“${deleting?.title ?? ""}” will be removed from the shared notebook.`}</DialogDescription>
          </DialogHeader>
          {remove.error && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {remove.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (deleting) remove.mutate(deleting);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
