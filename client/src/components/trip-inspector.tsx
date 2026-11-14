import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowRight, MessageSquare, Send } from "lucide-react";
import { useRef, useState } from "react";
import type {
  Trip,
  TripCommentCursor,
  TripCommentInput,
} from "../../../src/domain";
import { api, apiClient, money } from "../api";
import { ErrorState, Loading } from "./common";
import { Badge, Button, Textarea } from "./ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

export function TripInspector({
  trip,
  open,
  onOpenChange,
  opener,
}: {
  trip: Trip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opener: React.RefObject<HTMLElement | null>;
}) {
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  // Drafts survive closing the inspector and inspecting another trip on this page.
  const [drafts, setDrafts] = useState<
    Record<string, { id: string; body: string }>
  >({});
  const [posted, setPosted] = useState<string>();
  const key = trip?.trip_id;
  const draft = key ? drafts[key] : undefined;
  const comments = useInfiniteQuery({
    queryKey: ["trip-comments", key],
    enabled: !!trip && open,
    initialPageParam: undefined as TripCommentCursor | undefined,
    queryFn: ({ signal, pageParam }) => {
      if (!trip) throw new Error("Select a trip first");
      return api(
        apiClient.tripComments({
          query: { trip, ...(pageParam ? { cursor: pageParam } : {}) },
        }),
        signal,
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });
  const post = useMutation({
    mutationFn: (input: TripCommentInput) =>
      api(apiClient.addTripComment({ payload: input })),
    onSuccess: (_, input) => {
      const savedKey = input.trip.trip_id;
      setDrafts((previous) => {
        // Never clear text typed while a previous submission was in flight.
        if (previous[savedKey]?.id !== input.id) return previous;
        const next = { ...previous };
        delete next[savedKey];
        return next;
      });
      setPosted(savedKey);
      void client.invalidateQueries({
        queryKey: ["trip-comments", savedKey],
      });
    },
  });
  const rows = comments.data?.pages.flatMap((page) => page.rows) ?? [];
  const currentError =
    post.error && post.variables?.trip.trip_id === key ? post.error : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full gap-0 sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <SheetHeader className="shrink-0 border-b p-6 pr-12">
          <SheetTitle ref={heading} tabIndex={-1} className="outline-none">
            Trip details
          </SheetTitle>
          <SheetDescription>
            Inspect the record and leave context for your team.
          </SheetDescription>
        </SheetHeader>
        {trip && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <section
                aria-label="Selected trip"
                className="mb-6 rounded-xl border bg-muted/30 p-4"
              >
                <div className="mb-4 flex items-center gap-3 text-lg font-semibold tabular-nums">
                  {trip.pickup_zip}
                  <ArrowRight className="size-4 text-muted-foreground" />
                  {trip.dropoff_zip}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Pickup</dt>
                    <dd className="mt-1 tabular-nums">{trip.pickup_at}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Drop-off</dt>
                    <dd className="mt-1 tabular-nums">{trip.dropoff_at}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Fare</dt>
                    <dd className="mt-1 font-semibold">
                      {money(trip.fare, 2)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Distance · duration
                    </dt>
                    <dd className="mt-1">
                      {trip.distance.toFixed(2)} mi · {trip.duration.toFixed(1)}{" "}
                      min
                    </dd>
                  </div>
                </dl>
              </section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="size-4" />
                  Comments
                </h2>
                <Badge variant="secondary">Shared with your team</Badge>
              </div>
              {comments.isPending ? (
                <Loading text="Loading comments…" />
              ) : comments.error && !comments.data ? (
                <ErrorState
                  error={comments.error}
                  retry={() => void comments.refetch()}
                />
              ) : (
                <>
                  {!rows.length && (
                    <div className="rounded-lg border border-dashed px-5 py-7 text-center">
                      <p className="text-sm font-medium">
                        Start the conversation
                      </p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Flag an unusual fare, ask a question, or leave a next
                        step for another analyst.
                      </p>
                    </div>
                  )}
                  <ol aria-label="Trip comments" className="space-y-4">
                    {rows.map((comment) => (
                      <li key={comment.id} className="rounded-lg border p-4">
                        <div className="mb-2 flex flex-wrap justify-between gap-1 text-xs">
                          <span className="font-medium">
                            {comment.author?.name ?? "Workspace viewer"}
                          </span>
                          <time
                            dateTime={comment.created_at}
                            className="text-muted-foreground"
                          >
                            {new Date(comment.created_at).toLocaleString()}
                          </time>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">
                          {comment.body}
                        </p>
                      </li>
                    ))}
                  </ol>
                  {comments.error && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      {comments.error.message}
                    </p>
                  )}
                  {(comments.hasNextPage || comments.error) && (
                    <Button
                      variant="outline"
                      className="mt-4 w-full"
                      disabled={comments.isFetching}
                      onClick={() =>
                        void (comments.isFetchNextPageError || !comments.error
                          ? comments.fetchNextPage()
                          : comments.refetch())
                      }
                    >
                      {comments.isFetching
                        ? "Loading…"
                        : comments.error
                          ? "Retry loading comments"
                          : "Load older comments"}
                    </Button>
                  )}
                </>
              )}
              <p className="mt-5 text-xs leading-5 text-muted-foreground">
                Comments stay with this record across filters and sorting.
              </p>
            </div>
            <form
              className="shrink-0 space-y-3 border-t bg-background p-4 sm:p-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (draft?.body.trim() && !post.isPending)
                  post.mutate({ ...draft, trip });
              }}
            >
              <label
                htmlFor="trip-comment"
                className="block text-sm font-medium"
              >
                Add a comment
              </label>
              <Textarea
                id="trip-comment"
                maxLength={4000}
                required
                className="max-h-40 min-h-24 resize-y"
                placeholder="What should the next analyst know?"
                value={draft?.body ?? ""}
                disabled={post.isPending}
                onChange={(event) => {
                  setDrafts((previous) => ({
                    ...previous,
                    [trip.trip_id]: {
                      id: crypto.randomUUID(),
                      body: event.target.value,
                    },
                  }));
                  setPosted(undefined);
                  post.reset();
                }}
              />
              {currentError && (
                <p role="alert" className="text-sm text-destructive">
                  {currentError.message} Your draft is kept here.
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <span role="status" className="text-xs text-muted-foreground">
                  {posted === key
                    ? "Comment posted"
                    : "Visible to everyone using this app"}
                </span>
                <Button
                  type="submit"
                  disabled={!draft?.body.trim() || post.isPending}
                >
                  <Send />
                  {post.isPending ? "Posting…" : "Post comment"}
                </Button>
              </div>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
