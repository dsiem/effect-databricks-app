import { Bookmark, BookOpen, Check } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import type { NoteInput } from "../../../src/domain";
import { useFilters } from "../api";
import { Loading } from "./common";
import { NoteEditor } from "./note-editor";
import { Button } from "./ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

const Notebook = lazy(() => import("../pages/notebook"));

export function SavedViews() {
  const { filters, query, filterError } = useFilters();
  const [draft, setDraft] = useState<NoteInput | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ title: string; query: string }>();
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!!filterError}
        onClick={() =>
          setDraft({
            id: crypto.randomUUID(),
            title: "",
            body: "",
            filters,
            version: null,
          })
        }
      >
        <Bookmark />
        Save view
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" size="sm" variant="ghost">
            <BookOpen />
            Saved views
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full gap-0 sm:max-w-lg">
          <SheetHeader className="border-b p-6 pr-12">
            <SheetTitle>Saved views</SheetTitle>
            <SheetDescription>
              Shared findings and filters. Open a view to apply its filters
              here.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {open && (
              <Suspense fallback={<Loading text="Loading saved views…" />}>
                <Notebook embedded onRestore={() => setOpen(false)} />
              </Suspense>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {saved?.query === query && (
        <span
          role="status"
          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Check className="size-3.5 shrink-0" />
          <span className="max-w-48 truncate">Saved “{saved.title}”</span>
        </span>
      )}
      {draft && (
        <NoteEditor
          key={draft.id}
          note={draft}
          view
          onClose={() => setDraft(null)}
          onSaved={(title) => setSaved({ title, query })}
        />
      )}
    </>
  );
}
