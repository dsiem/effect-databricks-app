import { ArrowUp, ArrowUpRight, Check, Copy, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { GenieReply } from "../../../../src/domain";
import { useStatus } from "../../api";
import { turnBase, updateTurn } from "../../lib/genie-session";
import { FilterSummary } from "../explore-context";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "../ui";
import { useGenie } from "./provider";

const questions = {
  overview: [
    "Explain the main patterns in this view.",
    "Compare weekday and weekend trip activity.",
    "Which pickup hours have the highest average fare?",
  ],
  trips: [
    "Summarize the trips shown here.",
    "Find unusually high fares in the filtered dataset.",
    "Compare average fare by trip distance.",
  ],
  map: [
    "Explain the pickup distribution in this view.",
    "Compare the busiest pickup ZIP codes.",
    "Which pickup areas have the highest average fare?",
  ],
  notebook: [
    "Summarize trip activity for the current filters.",
    "Compare weekday and weekend fares.",
  ],
  genie: [
    "Which pickup ZIP codes have the most trips?",
    "How does the average fare change by hour of day?",
    "Show total trips and fare revenue by month.",
  ],
};

export function GenieConversation({
  focusComposer = false,
}: {
  focusComposer?: boolean;
}) {
  const {
    turns,
    persistenceError,
    busy,
    send,
    context,
    filters,
    filterError,
    selected,
    clearSelection,
    draft,
    setDraft,
  } = useGenie();
  const status = useStatus();
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const enabled = status.data?.genie === true && !filterError;
  useEffect(() => {
    if (enabled && focusComposer) composer.current?.focus();
  }, [enabled, focusComposer]);
  useEffect(() => {
    if (turns.length)
      bottom.current?.scrollIntoView({
        behavior: busy ? "auto" : "smooth",
        block: "nearest",
      });
  }, [turns.length, busy]);
  return (
    <>
      <section
        aria-label="Explore view for your next question"
        className="shrink-0 border-b bg-muted/30 px-4 py-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Looking at
            </p>
            <h3 className="text-sm font-medium">{context.title}</h3>
          </div>
          {selected && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Use whole page"
              title="Use whole page"
              onClick={clearSelection}
            >
              <X />
            </Button>
          )}
        </div>
        {filterError ? (
          <p role="alert" className="text-xs text-destructive">
            Correct the page filters before asking Genie.
          </p>
        ) : (
          <FilterSummary filters={filters} />
        )}
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          {context.data
            ? "Displayed data and applied filters included."
            : "Applied filters included."}{" "}
          Earlier answers keep their original view.
        </p>
      </section>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        {persistenceError && (
          <p role="alert" className="mb-4 text-xs text-destructive">
            {persistenceError}
          </p>
        )}
        {status.isPending ? (
          <p className="text-sm text-muted-foreground">Connecting to Genie…</p>
        ) : status.error ? (
          <div role="alert" className="space-y-3 text-sm">
            <p>Unable to connect to Genie. {status.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void status.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : !status.data.genie ? (
          <div className="py-5">
            <Sparkles className="mb-3 size-6 text-muted-foreground" />
            <h3 className="font-medium">Connect Genie to explore further</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Configure a Databricks Genie space for this workspace to ask
              questions about your taxi data.
            </p>
          </div>
        ) : null}
        {!turns.length && enabled && (
          <div className="py-3">
            <h3 className="text-lg font-semibold tracking-tight">
              Go deeper into this view
            </h3>
            <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">
              Explain what you’re seeing or ask Genie to run another analysis.
            </p>
            <div className="space-y-2">
              {questions[context.page].map((question) => (
                <Button
                  type="button"
                  variant="outline"
                  key={question}
                  onClick={() => send(question)}
                  className="h-auto w-full justify-between gap-3 whitespace-normal px-3 py-3 text-left text-xs font-normal leading-5"
                >
                  {question}
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-6" aria-live="polite">
          {turns.map((turn) => (
            <div key={turn.id}>
              <div className="mb-4 ml-6 rounded-xl rounded-tr-sm bg-muted px-4 py-3 text-sm leading-6">
                <p>{turn.question}</p>
                {turn.context && turn.filters && (
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      {turn.context.title} · View context
                    </summary>
                    <div className="mt-2">
                      <FilterSummary filters={turn.filters} />
                    </div>
                  </details>
                )}
              </div>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="size-3.5" />
                <p className="text-xs font-semibold">Genie</p>
              </div>
              {turn.state === "complete" ? (
                <GenieAnswer reply={turn.reply} />
              ) : "error" in turn ? (
                <div>
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive"
                  >
                    {turn.error}
                  </p>
                  {turn.state === "submission-rejected" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={busy}
                      onClick={() => {
                        setDraft(turn.question);
                        composer.current?.focus();
                      }}
                    >
                      Edit question
                    </Button>
                  )}
                  {turn.state === "paused" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={busy}
                      onClick={() =>
                        updateTurn(turn.id, () => ({
                          ...turnBase(turn),
                          operation: turn.operation,
                          state: turn.stage,
                        }))
                      }
                    >
                      {turn.stage === "retrieving"
                        ? "Retry result download"
                        : "Resume answer"}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-primary" />
                  Processing query…
                </p>
              )}
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </div>
      <div className="shrink-0 border-t bg-background p-3">
        <form
          className="rounded-xl border p-3 shadow-xs focus-within:ring-1 focus-within:ring-ring"
          onSubmit={(event) => {
            event.preventDefault();
            if (enabled) send(draft);
          }}
        >
          <Textarea
            ref={composer}
            aria-label="Ask a question about taxi data"
            placeholder="Ask about this view…"
            value={draft}
            maxLength={3500}
            disabled={!enabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (enabled) send(draft);
              }
            }}
            className="min-h-14 max-h-32 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {busy
                ? "Working on your question…"
                : "Enter to send · Shift + Enter for a new line"}
            </span>
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Send question"
              disabled={!enabled || busy || !draft.trim()}
            >
              <ArrowUp />
            </Button>
          </div>
        </form>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Genie can make mistakes. Check the SQL and results.
        </p>
      </div>
    </>
  );
}

function GenieAnswer({ reply }: { reply: GenieReply }) {
  return (
    <>
      <div className="text-sm leading-7 wrap-anywhere [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3">
        <Markdown>{reply.text || "Query results"}</Markdown>
      </div>
      {reply.queries.map((result) => (
        <div
          key={result.sql}
          className="mt-4 min-w-0 overflow-hidden rounded-lg border"
        >
          <div className="border-b bg-muted/50 px-3 py-2 text-xs font-medium">
            {result.description}
          </div>
          <div className="max-h-72 overflow-auto">
            <Table className="w-full whitespace-nowrap text-left text-xs">
              <TableHeader className="bg-muted/30">
                <TableRow>
                  {result.columns.map((column) => (
                    <TableHead key={column} className="px-3 py-2 text-xs">
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Query snapshots may contain duplicate rows and have no IDs.
                  <TableRow key={index}>
                    {row.map((cell, column) => (
                      <TableCell
                        key={result.columns[column]}
                        className="px-3 py-2 tabular-nums"
                      >
                        {cell ?? "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result.truncated && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing a bounded preview of the query result.
            </p>
          )}
          <details className="border-t p-3">
            <summary className="cursor-pointer text-xs font-medium">
              View generated SQL
            </summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-5 text-muted-foreground">
              {result.sql}
            </pre>
            <CopySql sql={result.sql} />
          </details>
        </div>
      ))}
    </>
  );
}

function CopySql({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2"
        onClick={() => {
          void navigator.clipboard.writeText(sql).then(
            () => {
              setCopied(true);
              setError(false);
              setTimeout(() => setCopied(false), 2000);
            },
            () => setError(true),
          );
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy SQL"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Unable to copy. Select the SQL above to copy it.
        </p>
      )}
    </>
  );
}
