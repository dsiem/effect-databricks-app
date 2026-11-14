import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Note, NoteCursor, NoteInput } from "../../../src/domain";
import { api, apiClient, useFilters } from "../api";
import { ErrorState, Loading, PageTitle } from "../components/common";
import { ExploreContext, FilterSummary } from "../components/explore-context";
import { NoteEditor } from "../components/note-editor";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui";
export default function Notebook({
  embedded = false,
  onRestore,
}: {
  embedded?: boolean;
  onRestore?: () => void;
}) {
  const { filters, setFilters } = useFilters();
  const client = useQueryClient();
  const navigate = useNavigate();
  const notes = useInfiniteQuery({
    queryKey: ["notes"],
    initialPageParam: undefined as NoteCursor | undefined,
    queryFn: ({ signal, pageParam }) =>
      api(
        apiClient.notes({
          query: pageParam ? { cursor: pageParam } : {},
        }),
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });
  const savedNotes = notes.data?.pages.flatMap((page) => page.rows) ?? [];
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
      {!embedded && (
        <PageTitle
          title="Analyst notebook"
          description="Browse shared findings and saved views. You can also save a view directly from Explore."
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
      )}
      {!embedded && (
        <div className="mb-6">
          <ExploreContext purpose="note" />
        </div>
      )}
      {notes.isPending ? (
        <Loading
          text={embedded ? "Loading saved views…" : "Loading saved notes…"}
        />
      ) : notes.error && !notes.data ? (
        <ErrorState error={notes.error} retry={() => void notes.refetch()} />
      ) : !savedNotes.length ? (
        <Card className="flex min-h-80 flex-col gap-0 items-center justify-center p-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted">
            <BookOpen className="size-6 text-primary" />
          </span>
          <h2 className="mt-5 text-lg font-semibold">
            {embedded ? "Keep a view worth returning to" : "No saved notes"}
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {embedded
              ? "Save a view from the filter bar. Add a finding to give your team a starting point."
              : "Create a note to save your findings and the Explore view shown above."}
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
            {embedded ? "Save this view" : "Create note"}
          </Button>
        </Card>
      ) : (
        <>
          <p aria-live="polite" className="mb-4 text-sm text-muted-foreground">
            {savedNotes.length} saved{" "}
            {embedded
              ? savedNotes.length === 1
                ? "view"
                : "views"
              : savedNotes.length === 1
                ? "note"
                : "notes"}{" "}
            shown · shared across this app
          </p>
          <div
            className={
              embedded
                ? "grid gap-4"
                : "grid gap-5 md:grid-cols-2 xl:grid-cols-3"
            }
          >
            {savedNotes.map((note) => (
              <Card key={note.id} className="gap-0 p-6">
                <div className="mb-4 flex items-start gap-3">
                  <h2 className="min-w-0 flex-1 break-words text-base font-semibold tracking-tight">
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
                <p className="mb-5 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {note.body || "No additional details."}
                </p>
                <div className="mt-auto">
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {embedded ? "Filters" : "Saved Explore view"}
                    </p>
                    <FilterSummary filters={note.filters} />
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-3 h-auto p-0"
                      aria-label={`Open saved view for ${note.title}`}
                      onClick={() => {
                        if (embedded) {
                          setFilters(note.filters);
                          onRestore?.();
                        } else
                          navigate(
                            `/?${new URLSearchParams(Object.entries(note.filters))}`,
                          );
                      }}
                    >
                      Open saved view
                      {embedded ? (
                        <ArrowRight className="size-3.5" />
                      ) : (
                        <ExternalLink className="size-3.5" />
                      )}
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
          {notes.error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {notes.error.message}
            </p>
          )}
          {(notes.hasNextPage || notes.error) && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                disabled={notes.isFetching}
                onClick={() =>
                  void (notes.isFetchNextPageError || !notes.error
                    ? notes.fetchNextPage()
                    : notes.refetch())
                }
              >
                {notes.isFetching
                  ? "Loading notes…"
                  : notes.error
                    ? "Retry loading notes"
                    : embedded
                      ? "Load more views"
                      : "Load more notes"}
              </Button>
            </div>
          )}
          {pin.error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {pin.error.message}
            </p>
          )}
        </>
      )}
      {editing && (
        <NoteEditor
          key={editing.id}
          note={editing}
          view={embedded}
          onClose={() => setEditing(null)}
          onCloseAutoFocus={restoreDialogFocus}
        />
      )}
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
