import { useMutation } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  Copy,
  MessageSquarePlus,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { GenieReply } from "../../../src/domain";
import { api, useFilters, useStatus } from "../api";
import { ErrorState, PageTitle } from "../components/common";
import { Badge, Button, Card, Textarea } from "../components/ui";

type Turn = {
  id: string;
  question: string;
  reply?: GenieReply;
  error?: string;
};
const questions = [
  "Which pickup ZIP codes have the most trips?",
  "How does the average fare change by hour of day?",
  "Show total trips and fare revenue by month.",
  "What are the longest trips in the dataset?",
];
export default function AskGenie() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const { filters, query } = useFilters();
  const status = useStatus();
  const bottom = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const ask = useMutation({
    mutationFn: (content: string) => {
      controller.current = new AbortController();
      const context = query
        ? `\n\nApply these filters to tpep_pickup_datetime and pickup_zip: ${JSON.stringify(filters)}. The to date is inclusive.`
        : "";
      return api(
        "/api/genie",
        GenieReply,
        {
          method: "POST",
          body: JSON.stringify({
            content: content + context,
            ...(conversationId ? { conversationId } : {}),
          }),
        },
        controller.current.signal,
      );
    },
    onSuccess: (reply) => {
      setConversationId(reply.conversationId);
      setTurns((ts) =>
        ts.map((t, i) => (i === ts.length - 1 ? { ...t, reply } : t)),
      );
    },
    onError: (error) =>
      setTurns((ts) =>
        ts.map((t, i) =>
          i === ts.length - 1 ? { ...t, error: error.message } : t,
        ),
      ),
  });
  const send = (question: string) => {
    if (!question.trim() || ask.isPending) return;
    setTurns((ts) => [
      ...ts,
      { id: crypto.randomUUID(), question: question.trim() },
    ]);
    setDraft("");
    ask.mutate(question.trim());
  };
  useEffect(() => {
    if (turns.length || ask.isPending)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length, ask.isPending]);
  return (
    <>
      <PageTitle
        title="Query trip data"
        description="Use natural language to query taxi trips with Databricks Genie."
        action={
          <Button
            variant="outline"
            disabled={ask.isPending || !turns.length}
            onClick={() => {
              setTurns([]);
              setConversationId(undefined);
              ask.reset();
            }}
          >
            <MessageSquarePlus />
            New conversation
          </Button>
        }
      />
      {status.data && !status.data.genie ? (
        <ErrorState
          error={
            new Error(
              "Set GENIE_SPACE_ID to a Genie space over samples.nyctaxi.trips to enable natural language queries.",
            )
          }
        />
      ) : (
        <Card className="flex min-h-[640px] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-4">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Sparkles className="size-4 text-primary" />
              Metrocab Genie
            </span>
            <Badge className="bg-[#edf3e8] text-primary">
              samples.nyctaxi.trips
            </Badge>
          </div>
          <div className="flex-1 p-5 sm:p-8">
            {!turns.length && (
              <div className="mx-auto max-w-2xl py-9 text-center">
                <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-[#eff3e7]">
                  <Sparkles className="size-7 text-[#63814b]" />
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
                    <button
                      type="button"
                      key={question}
                      onClick={() => send(question)}
                      className="group flex items-start gap-3 rounded-xl border p-4 text-xs leading-5 transition-colors hover:border-[#9bb289] hover:bg-muted/50"
                    >
                      <Sparkles className="mt-1 size-3.5 shrink-0 text-[#a3b58c]" />
                      {question}
                      <ArrowUp className="ml-auto mt-1 size-3 shrink-0 rotate-45 text-muted-foreground group-hover:text-primary" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mx-auto max-w-3xl space-y-7" aria-live="polite">
              {turns.map((turn) => (
                <div key={turn.id}>
                  <div className="mb-5 ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[#edf2e8] px-5 py-3 text-sm leading-6">
                    {turn.question}
                  </div>
                  <div className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-white">
                      <Sparkles className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="mb-2 text-xs font-semibold">Genie</p>
                      {turn.reply ? (
                        <>
                          <div className="text-sm leading-7 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3">
                            <Markdown>
                              {turn.reply.text || "Query results"}
                            </Markdown>
                          </div>
                          {turn.reply.queries.map((result) => (
                            <div
                              key={result.sql}
                              className="mt-4 overflow-hidden rounded-xl border"
                            >
                              <div className="border-b bg-muted/50 px-4 py-3 text-xs font-medium">
                                {result.description}
                              </div>
                              <div className="max-h-80 overflow-auto">
                                <table className="w-full whitespace-nowrap text-left text-xs">
                                  <thead className="bg-muted/30">
                                    <tr>
                                      {result.columns.map((column) => (
                                        <th
                                          key={column}
                                          className="px-4 py-3 font-medium"
                                        >
                                          {column}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {result.rows.map((row, k) => (
                                      // biome-ignore lint/suspicious/noArrayIndexKey: Query snapshots can contain duplicate rows and have no row IDs.
                                      <tr key={k} className="border-t">
                                        {row.map((cell, c) => (
                                          <td
                                            key={result.columns[c]}
                                            className="px-4 py-3 tabular-nums"
                                          >
                                            {cell ?? "—"}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {result.truncated && (
                                <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">
                                  Showing a bounded preview of the query result.
                                </p>
                              )}
                              <details className="border-t p-4">
                                <summary className="cursor-pointer text-[11px] font-medium text-primary">
                                  View generated SQL
                                </summary>
                                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                                  {result.sql}
                                </pre>
                                <CopySql sql={result.sql} />
                              </details>
                            </div>
                          ))}
                        </>
                      ) : turn.error ? (
                        <p
                          role="alert"
                          className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-xs leading-6 text-destructive"
                        >
                          {turn.error} You can retry your question below.
                        </p>
                      ) : (
                        <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
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
            className="mx-5 mb-5 rounded-xl border bg-background/70 p-3 sm:mx-8"
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
              className="min-h-14 resize-none border-0 bg-transparent p-1 focus:ring-0"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {query
                  ? "Current date and ZIP filters included"
                  : "Enter to send · Shift + Enter for a new line"}
              </span>
              <Button
                type="submit"
                size="icon"
                aria-label="Send question"
                disabled={ask.isPending || !draft.trim()}
              >
                <ArrowUp />
              </Button>
            </div>
          </form>
          <p className="mb-5 px-5 text-center text-[10px] text-muted-foreground">
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
