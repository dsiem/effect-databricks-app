import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Data, Effect } from "effect";

const run = promisify(execFile);

class DatabricksError extends Data.TaggedError("DatabricksError")<{
  message: string;
}> {}

export const operation = <T>(execute: () => Promise<T>) =>
  Effect.tryPromise({
    try: execute,
    catch: (cause) =>
      new DatabricksError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

export async function cli(host: string, args: string[], body?: object) {
  const flags = body === undefined ? [] : ["--json", JSON.stringify(body)];
  const { stdout } = await run(
    "databricks",
    [...args, ...flags, "-o", "json"],
    {
      // Apps commands inside a bundle can dispatch to the bundle deployment workflow.
      cwd: tmpdir(),
      env: { ...process.env, DATABRICKS_HOST: host },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout;
}
