import { Effect } from "effect";
import {
  ArrowUp,
  Check,
  Copy,
  MessageSquarePlus,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Markdown from "react-markdown";
import { api, apiClient, useFilters, useStatus } from "../api";
import { ErrorState, PageTitle } from "../components/common";
import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "../components/ui";

import {
  conversationId,
  genieSnapshot,
  saveTurns,
  subscribeGenie,
  updateTurn,
} from "../lib/genie-session";

const questions = [
  "Which pickup ZIP codes have the most trips?",
  "How does the average fare change by hour of day?",
  "Show total trips and fare revenue by month.",
  "What are the longest trips in the dataset?",
];
export default function AskGenie() {
  const { turns, persistenceError } = useSyncExternalStore(
    subscribeGenie,
    genieSnapshot,
  );
  const [draft, setDraft] = useState("");
  const { filters, query } = useFilters();
  const status = useStatus();
  const bottom = useRef<HTMLDivElement>(null);
  const busy = turns.some((turn) =>
    ["submitting", "waiting", "retrieving"].includes(turn.state),
  );
  const activeId = turns.find(
    (turn) => turn.state === "waiting" || turn.state === "retrieving",
  )?.id;
  // Submission continues across route navigation so its response can be saved.
  // Reads are cancelled on navigation and resume from the persisted operation.
  useEffect(() => {
    const active = genieSnapshot().turns.find((turn) => turn.id === activeId);
    if (!active || !("operation" in active)) return;
    const controller = new AbortController();
    const { operation, id } = active;
    let stage: "waiting" | "retrieving" =
      active.state === "retrieving" ? "retrieving" : "waiting";
    void (async () => {
      try {
        if (stage === "waiting") {
          const deadline = Date.now() + 180_000;
          while (true) {
            const progress = await api(
              apiClient.pollGenie({ params: operation }),
              controller.signal,
            );
            if (progress.state === "failed") {
              updateTurn(id, (turn) => ({
                id,
                question: turn.question,
                operation,
                state: "failed",
                error: `Genie could not complete this question (${progress.status}).`,
              }));
              return;
            }
            if (progress.state === "completed") break;
            if (Date.now() >= deadline)
              throw new Error(
                "Genie is taking longer than expected. Resume waiting for this answer.",
              );
            await Effect.runPromise(Effect.sleep("1 second"), {
              signal: controller.signal,
            });
          }
          stage = "retrieving";
          updateTurn(id, (turn) => ({
            id,
            question: turn.question,
            operation,
            state: "retrieving",
          }));
        }
        const reply = await api(
          apiClient.genieResult({ params: operation }),
          controller.signal,
        );
        updateTurn(id, (turn) => ({
          id,
          question: turn.question,
          state: "complete",
          reply,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        updateTurn(id, (turn) => ({
          id,
          question: turn.question,
          operation,
          state: "paused",
          stage,
          error:
            error instanceof Error
              ? error.message
              : "Unable to retrieve this answer.",
        }));
      }
    })();
    return () => controller.abort();
    // A stage transition keeps the same recovery operation running.
  }, [activeId]);
  const send = (question: string) => {
    if (!question.trim() || busy) return;
    const id = crypto.randomUUID();
    const content = question.trim();
    const previousConversation = conversationId();
    saveTurns([...turns, { id, question: content, state: "submitting" }]);
    setDraft("");
    const context = query
      ? `\n\nApply these filters to tpep_pickup_datetime and pickup_zip: ${JSON.stringify(filters)}. The to date is inclusive.`
      : "";
    void api(
      apiClient.submitGenie({
        payload: {
          content: content + context,
          ...(previousConversation
            ? { conversationId: previousConversation }
            : {}),
        },
      }),
    ).then(
      (operation) =>
        updateTurn(id, (turn) => ({
          id,
          question: turn.question,
          state: "waiting",
          operation,
        })),
      (error: unknown) =>
        updateTurn(id, (turn) => ({
          id,
          question: turn.question,
          state: "submission-unknown",
          error: `${error instanceof Error ? error.message : "The submission response was lost."} The question may have been accepted. Check Genie before submitting it again.`,
        })),
    );
  };
  useEffect(() => {
    if (turns.length || busy)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length, busy]);
  return (
    <>
      <PageTitle
        title="Query trip data"
        description="Use natural language to query taxi trips with Databricks Genie."
        action={
          <Button
            variant="outline"
            disabled={busy || !turns.length}
            onClick={() => {
              saveTurns([]);
            }}
          >
            <MessageSquarePlus />
            New conversation
          </Button>
        }
      />
      {persistenceError && <p role="alert">{persistenceError}</p>}
      {status.data && !status.data.genie ? (
        <ErrorState
          error={
            new Error(
              "Set GENIE_SPACE_ID to a Genie space over samples.nyctaxi.trips to enable natural language queries.",
            )
          }
        />
      ) : (
        <Card className="min-h-[640px] gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-primary" />
              Ask Genie
            </span>
            <Badge variant="outline">samples.nyctaxi.trips</Badge>
          </div>
          <div className="flex-1 p-5 sm:p-8">
            {!turns.length && (
              <div className="mx-auto max-w-2xl py-9 text-center">
                <div className="mx-auto mb-6 grid size-16 place-items-center rounded-lg border bg-muted">
                  <Sparkles className="size-7 text-foreground" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Example queries
                </h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  Select a query or enter a question about trip counts, fares,
                  distances, or pickup patterns.
                </p>
                <div className="mt-9 grid gap-3 text-left sm:grid-cols-2">
                  {questions.map((question) => (
                    <Button
                      variant="outline"
                      type="button"
                      key={question}
                      onClick={() => send(question)}
                      className="group flex items-start gap-3 h-auto justify-start whitespace-normal rounded-lg p-4 text-left text-sm font-normal leading-6"
                    >
                      <Sparkles className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                      {question}
                      <ArrowUp className="ml-auto mt-1 size-3 shrink-0 rotate-45 text-muted-foreground group-hover:text-primary" />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="mx-auto max-w-3xl space-y-7" aria-live="polite">
              {turns.map((turn) => (
                <div key={turn.id}>
                  <div className="mb-5 ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-muted px-5 py-3 text-sm leading-6">
                    {turn.question}
                  </div>
                  <div className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                      <Sparkles className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="mb-2 text-sm font-semibold">Genie</p>
                      {turn.state === "complete" ? (
                        <>
                          <div className="text-sm leading-7 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3">
                            <Markdown>
                              {turn.reply.text || "Query results"}
                            </Markdown>
                          </div>
                          {turn.reply.queries.map((result) => (
                            <div
                              key={result.sql}
                              className="mt-4 overflow-hidden rounded-lg border"
                            >
                              <div className="border-b bg-muted/50 px-4 py-3 text-sm font-medium">
                                {result.description}
                              </div>
                              <div className="max-h-80 overflow-auto">
                                <Table className="w-full whitespace-nowrap text-left text-sm">
                                  <TableHeader className="bg-muted/30">
                                    <TableRow>
                                      {result.columns.map((column) => (
                                        <TableHead
                                          key={column}
                                          className="px-4 py-3 font-medium"
                                        >
                                          {column}
                                        </TableHead>
                                      ))}
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {result.rows.map((row, k) => (
                                      // biome-ignore lint/suspicious/noArrayIndexKey: Query snapshots can contain duplicate rows and have no row IDs.
                                      <TableRow key={k} className="border-t">
                                        {row.map((cell, c) => (
                                          <TableCell
                                            key={result.columns[c]}
                                            className="px-4 py-3 tabular-nums"
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
                                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                                  Showing a bounded preview of the query result.
                                </p>
                              )}
                              <details className="border-t p-4">
                                <summary className="cursor-pointer text-xs font-medium text-primary">
                                  View generated SQL
                                </summary>
                                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                                  {result.sql}
                                </pre>
                                <CopySql sql={result.sql} />
                              </details>
                            </div>
                          ))}
                        </>
                      ) : "error" in turn ? (
                        <div>
                          <p
                            role="alert"
                            className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
                          >
                            {turn.error}
                          </p>
                          {turn.state === "paused" && (
                            <Button
                              variant="outline"
                              className="mt-3"
                              disabled={busy}
                              onClick={() =>
                                updateTurn(turn.id, () => ({
                                  id: turn.id,
                                  question: turn.question,
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
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
          </div>
          <form
            className="mx-5 mb-5 rounded-lg border bg-background/70 p-3 sm:mx-8"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <Textarea
              aria-label="Ask a question about taxi data"
              placeholder="Enter a question about NYC taxi trips…"
              value={draft}
              maxLength={3500}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              className="min-h-14 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {query
                  ? "Current date and ZIP filters included"
                  : "Enter to send · Shift + Enter for a new line"}
              </span>
              <Button
                type="submit"
                size="icon"
                aria-label="Send question"
                disabled={busy || !draft.trim()}
              >
                <ArrowUp />
              </Button>
            </div>
          </form>
          <p className="mb-5 px-5 text-center text-xs text-muted-foreground">
            Genie can make mistakes. Review generated SQL and results before
            drawing conclusions.
          </p>
        </Card>
      )}
    </>
  );
}
function CopySql({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="mt-2"
      onClick={() => {
        void navigator.clipboard.writeText(sql).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy SQL"}
    </Button>
  );
}
