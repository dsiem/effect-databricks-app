import { type Duration, Effect, Semaphore } from "effect";
import { OperationTimeout } from "./errors.js";

// Construct once per service, outside request and cache lookups. The deadline
// surrounds acquisition so expired or interrupted waiters cannot start work.
export const makeAdmission = (options: {
  readonly concurrency: number;
  readonly timeout: Duration.Input;
  readonly service: "warehouse" | "genie";
}) => {
  const semaphore = Semaphore.makeUnsafe(options.concurrency);
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    semaphore.withPermit(effect).pipe(
      Effect.timeoutOrElse({
        duration: options.timeout,
        orElse: () =>
          Effect.fail(
            new OperationTimeout({
              service: options.service,
              message: `${options.service === "warehouse" ? "Warehouse query" : "Genie submission"} timed out while waiting or running. Try again.`,
            }),
          ),
      }),
    );
};
