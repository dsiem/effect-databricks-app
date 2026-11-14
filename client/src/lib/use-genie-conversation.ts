import { Effect } from "effect";
import { useEffect, useSyncExternalStore } from "react";
import type { Filters, GenieContext } from "../../../src/domain";
import { ApiRequestError, api, apiClient } from "./api-client";
import {
  conversationId,
  genieSnapshot,
  saveTurns,
  subscribeGenie,
  turnBase,
  updateTurn,
} from "./genie-session";

export function useGenieConversation() {
  const { turns, persistenceError } = useSyncExternalStore(
    subscribeGenie,
    genieSnapshot,
  );
  const busy = turns.some((turn) =>
    ["submitting", "waiting", "retrieving"].includes(turn.state),
  );
  const activeId = turns.find(
    (turn) => turn.state === "waiting" || turn.state === "retrieving",
  )?.id;
  // The layout owns this hook so reads continue while the helper is closed or
  // the user changes pages. Reloads recover from the persisted operation.
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
                ...turnBase(turn),
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
            ...turnBase(turn),
            operation,
            state: "retrieving",
          }));
        }
        const reply = await api(
          apiClient.genieResult({ params: operation }),
          controller.signal,
        );
        updateTurn(id, (turn) => ({
          ...turnBase(turn),
          state: "complete",
          reply,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        updateTurn(id, (turn) => ({
          ...turnBase(turn),
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
  const send = (question: string, filters: Filters, context: GenieContext) => {
    const current = genieSnapshot().turns;
    if (
      !question.trim() ||
      current.some((turn) =>
        ["submitting", "waiting", "retrieving"].includes(turn.state),
      )
    )
      return;
    const id = crypto.randomUUID();
    const content = question.trim();
    const previousConversation = conversationId();
    saveTurns([
      ...current,
      { id, question: content, filters, context, state: "submitting" },
    ]);
    void api(
      apiClient.submitGenie({
        payload: {
          content,
          filters,
          context,
          ...(previousConversation
            ? { conversationId: previousConversation }
            : {}),
        },
      }),
    ).then(
      (operation) =>
        updateTurn(id, (turn) => ({
          ...turnBase(turn),
          state: "waiting",
          operation,
        })),
      (error: unknown) => {
        // Only explicit rejections prove non-acceptance. Timeouts (including
        // upstream 408), server errors, and lost/invalid responses remain uncertain.
        const rejected =
          error instanceof ApiRequestError &&
          (error.code === "invalid_request" ||
            [400, 401, 403, 404, 409, 422, 429].includes(
              error.upstreamStatus ?? 0,
            ));
        const message =
          error instanceof Error
            ? error.message
            : "The submission response was lost.";
        updateTurn(id, (turn) => ({
          ...turnBase(turn),
          state: rejected ? "submission-rejected" : "submission-unknown",
          error: rejected
            ? `The question was rejected. ${message}`
            : `${message} The question may have been accepted. Check Genie before submitting it again.`,
        }));
      },
    );
  };
  return { turns, persistenceError, busy, send };
}
