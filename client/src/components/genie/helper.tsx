import {
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Sparkles,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import type { GenieContext } from "../../../../src/domain";
import { useIsMobile } from "../../hooks/use-mobile";
import { saveTurns } from "../../lib/genie-session";
import { Button, cn } from "../ui";
import { useGenie } from "./provider";

const GenieConversation = lazy(async () => ({
  default: (await import("./conversation")).GenieConversation,
}));

export function AskGenieButton({
  context,
  question,
  children = "Ask Genie",
  className,
}: {
  context?: GenieContext;
  question?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { openHelper, filterError } = useGenie();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={!!filterError}
      onClick={() => openHelper(context, question)}
    >
      <Sparkles className="size-3.5" />
      {children}
    </Button>
  );
}

export function GenieHeader({ floating = false }: { floating?: boolean }) {
  const { busy, turns, expanded, setExpanded, setOpen } = useGenie();
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <div>
          <h2 id="genie-helper-title" className="text-sm font-semibold">
            Genie
          </h2>
          <p
            id="genie-helper-description"
            className="text-xs text-muted-foreground"
          >
            Your data, in context
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New conversation"
          title="New conversation"
          disabled={busy || !turns.length}
          onClick={() => saveTurns([])}
        >
          <MessageSquarePlus />
        </Button>
        {floating && (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={expanded ? "Minimize Genie" : "Expand Genie"}
              title={expanded ? "Minimize Genie" : "Expand Genie"}
              className="hidden md:inline-flex"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close Genie"
              title="Close Genie"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function GenieHelper() {
  const { open, setOpen, expanded, opener } = useGenie();
  const { pathname } = useLocation();
  const mobile = useIsMobile();
  return (
    <Dialog.Root
      open={open && pathname !== "/genie"}
      onOpenChange={setOpen}
      modal={mobile}
    >
      <Dialog.Portal>
        {mobile && (
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        )}
        <Dialog.Content
          aria-labelledby="genie-helper-title"
          aria-describedby="genie-helper-description"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (!mobile) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className={cn(
            "fixed z-50 flex min-h-0 flex-col overflow-hidden border bg-background shadow-2xl outline-none bottom-0 right-0 h-[min(760px,100dvh)] w-full rounded-t-2xl md:bottom-5 md:right-5 md:h-[min(680px,calc(100dvh-100px))] md:w-[440px] md:rounded-xl",
            expanded &&
              "md:inset-y-5 md:h-auto md:w-[min(900px,calc(100vw-300px))]",
          )}
        >
          <Dialog.Title className="sr-only">Genie</Dialog.Title>
          <Dialog.Description className="sr-only">
            Ask questions about the current page and its data.
          </Dialog.Description>
          <GenieHeader floating />
          <Suspense
            fallback={
              <p className="p-5 text-sm text-muted-foreground">
                Opening Genie…
              </p>
            }
          >
            <GenieConversation focusComposer />
          </Suspense>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
