import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  Database,
  ExternalLink,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Note, NoteInput } from "../../../src/domain";
import { api, apiClient, useFilters } from "../api";
import { ErrorState, Loading, PageTitle } from "../components/common";
import { Badge, Button, Card, Dialog, Input, Textarea } from "../components/ui";
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
  const save = useMutation({
    mutationFn: (note: NoteInput) => api(apiClient.saveNote({ payload: note })),
    onSuccess: () => {
      setEditing(null);
      void client.invalidateQueries({ queryKey: ["notes"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(apiClient.removeNote({ params: { id } })),
    onSuccess: () => {
      setDeleting(null);
      void client.invalidateQueries({ queryKey: ["notes"] });
    },
  });
  const open = (note: NoteInput) => {
    save.reset();
    setEditing(note);
  };
  return (
    <>
      <PageTitle
        title="Analyst notebook"
        description="Save analysis notes with date and pickup ZIP filters in a shared notebook."
        action={
          <Button
            onClick={() =>
              open({
                id: crypto.randomUUID(),
                title: "",
                body: "",
                filters,
                pinned: false,
              })
            }
          >
            <Plus />
            New note
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d8e2d0] bg-[#edf3e8] px-5 py-4">
        <div className="flex items-center gap-3">
          <Database className="size-5 text-primary" />
          <div>
            <p className="text-xs font-medium">Shared note storage</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Notes are stored in Lakebase PostgreSQL and persist across
              sessions.
            </p>
          </div>
        </div>
        <Badge className="bg-white/70 text-primary">
          Lakebase · PostgreSQL
        </Badge>
      </div>
      {notes.isPending ? (
        <Loading text="Loading saved notes…" />
      ) : notes.error ? (
        <ErrorState error={notes.error} retry={() => void notes.refetch()} />
      ) : !notes.data.length ? (
        <Card className="flex min-h-80 flex-col items-center justify-center p-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted">
            <BookOpen className="size-6 text-primary" />
          </span>
          <h2 className="mt-5 text-lg font-semibold">No saved notes</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Create a note to save analysis details and the current date and
            pickup ZIP filters.
          </p>
          <Button
            className="mt-6"
            onClick={() =>
              open({
                id: crypto.randomUUID(),
                title: "",
                body: "",
                filters,
                pinned: false,
              })
            }
          >
            <Plus />
            Create note
          </Button>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            {notes.data.length} saved{" "}
            {notes.data.length === 1 ? "note" : "notes"} · shared across this
            app
          </p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {notes.data.map((note) => (
              <Card key={note.id} className="flex flex-col p-6">
                <div className="mb-4 flex items-start gap-3">
                  <h2 className="flex-1 text-base font-semibold tracking-tight">
                    {note.title}
                  </h2>
                  <button
                    aria-label={
                      note.pinned ? `Unpin ${note.title}` : `Pin ${note.title}`
                    }
                    type="button"
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate({ ...note, pinned: !note.pinned })
                    }
                  >
                    <Pin
                      className={`size-4 ${note.pinned ? "fill-secondary text-[#a38b39]" : "text-muted-foreground"}`}
                    />
                  </button>
                </div>
                <p className="mb-5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {note.body || "No additional details."}
                </p>
                <div className="mt-auto">
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {note.filters.from && (
                      <Badge>
                        <CalendarDays className="size-3" />
                        {note.filters.from}
                      </Badge>
                    )}
                    {note.filters.to && <Badge>to {note.filters.to}</Badge>}
                    {note.filters.zip && <Badge>ZIP {note.filters.zip}</Badge>}
                    {!Object.keys(note.filters).length && (
                      <Badge>All taxi data</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t pt-4">
                    <span className="text-[10px] text-muted-foreground">
                      Updated {new Date(note.updated_at).toLocaleDateString()}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Open saved view for ${note.title}`}
                        onClick={() =>
                          navigate(
                            `/?${new URLSearchParams(Object.entries(note.filters))}`,
                          )
                        }
                      >
                        <ExternalLink />
                      </Button>
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
          {save.error && !editing && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {save.error.message}
            </p>
          )}
        </>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setEditing(null);
        }}
        title={
          notes.data?.some((n) => n.id === editing?.id)
            ? "Edit note"
            : "New note"
        }
        description="Save analysis details and filters in the shared notebook."
      >
        {editing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({ ...editing, title: editing.title.trim() });
            }}
            className="space-y-5"
          >
            <label htmlFor="note-title" className="block text-xs font-medium">
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
            <label htmlFor="note-body" className="block text-xs font-medium">
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
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              Saved view: {editing.filters.from ?? "All dates"}
              {editing.filters.to ? ` — ${editing.filters.to}` : ""} ·{" "}
              {editing.filters.zip
                ? `ZIP ${editing.filters.zip}`
                : "All pickup areas"}
            </div>
            {save.error && (
              <p role="alert" className="text-xs text-destructive">
                {save.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
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
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete this note?"
        description={`“${deleting?.title ?? ""}” will be removed from the shared notebook.`}
      >
        {remove.error && (
          <p role="alert" className="mb-4 text-xs text-destructive">
            {remove.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
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
              if (deleting) remove.mutate(deleting.id);
            }}
          >
            {remove.isPending ? "Deleting…" : "Delete note"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
