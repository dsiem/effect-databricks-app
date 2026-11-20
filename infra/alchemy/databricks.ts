import { posix } from "node:path";
import { isResolved, Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Effect, Schema } from "effect";
import { cli, operation } from "./cli.ts";

interface FileProps {
  host: string;
  directory: string;
  filename: string;
  content: string;
}

type WorkspaceFile = Resource<
  "Databricks.WorkspaceFile",
  FileProps,
  { path: string; objectId: number }
>;
export const WorkspaceFile = Resource<WorkspaceFile>(
  "Databricks.WorkspaceFile",
);

const files = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      path: Schema.String,
      object_id: Schema.Int,
      object_type: Schema.String,
    }),
  ),
);

async function findFile(host: string, path: string) {
  const result = await cli(host, ["workspace", "list", posix.dirname(path)]);
  const canonical = (value: string) => value.replace(/^\/Workspace\//, "/");
  return files(JSON.parse(result)).find(
    (file) => canonical(file.path) === canonical(path),
  );
}

export const fileProvider = Provider.succeed(WorkspaceFile, {
  stables: ["path"],
  diff: ({ olds, news }) =>
    Effect.succeed(
      isResolved(news) &&
        (olds.host !== news.host ||
          olds.directory !== news.directory ||
          olds.filename !== news.filename)
        ? { action: "replace" as const }
        : undefined,
    ),
  reconcile: ({ news, instanceId, output }) =>
    operation(async () => {
      if (
        posix.basename(news.filename) !== news.filename ||
        !news.filename.endsWith(".sql")
      ) {
        throw new Error("Expected a SQL filename without directory components");
      }
      const path = posix.join(news.directory, instanceId + "-" + news.filename);
      const existing = await findFile(news.host, path);
      if (
        existing &&
        (existing.object_type !== "FILE" ||
          (output && existing.object_id !== output.objectId))
      ) {
        throw new Error("A different workspace object occupies " + path);
      }
      if (existing && !output) {
        // A create may have succeeded before Alchemy persisted the returned ID.
        if (
          (await cli(news.host, [
            "workspace",
            "export",
            path,
            "--format",
            "RAW",
          ])) !== news.content
        ) {
          throw new Error("Workspace file already exists at " + path);
        }
        return { path, objectId: existing.object_id };
      }
      await cli(news.host, ["api", "post", "/api/2.0/workspace/import"], {
        path,
        format: "RAW",
        content: Buffer.from(news.content).toString("base64"),
        overwrite: !!existing,
      });
      const file = await findFile(news.host, path);
      if (file?.object_type !== "FILE")
        throw new Error("Could not verify uploaded file " + path);
      return { path, objectId: file.object_id };
    }),
  delete: ({ olds, output }) =>
    operation(async () => {
      const file = await findFile(olds.host, output.path);
      if (!file) return;
      if (file.object_type !== "FILE" || file.object_id !== output.objectId) {
        throw new Error("A different workspace object occupies " + output.path);
      }
      await cli(olds.host, ["workspace", "delete", output.path]);
    }),
});

interface SqlJobSettings {
  name: string;
  description: string;
  max_concurrent_runs: number;
  queue: { enabled: boolean };
  parameters: { name: string; default: string }[];
  tasks: {
    task_key: string;
    sql_task: {
      warehouse_id: string;
      file: { path: string; source: "WORKSPACE" };
      parameters: Record<string, string>;
    };
  }[];
}

type SqlJob = Resource<
  "Databricks.SqlJob",
  { host: string; settings: SqlJobSettings },
  { jobId: number }
>;
export const SqlJob = Resource<SqlJob>("Databricks.SqlJob");

const jobId = Schema.Struct({ job_id: Schema.Int });
const jobs = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      ...jobId.fields,
      settings: Schema.Struct({
        tags: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      }),
    }),
  ),
);

async function ownedJob(
  host: string,
  name: string,
  instanceId: string,
  savedId?: number,
) {
  // Include renamed jobs when we have a recorded ID. Job names are not unique.
  const args = savedId === undefined ? ["--name", name] : [];
  const result = await cli(host, ["jobs", "list", ...args]);
  const listed = jobs(JSON.parse(result));
  const matches = listed.filter(
    (job) => job.settings.tags?.alchemy_instance === instanceId,
  );
  if (matches.length > 1)
    throw new Error("Multiple jobs carry the same Alchemy instance tag");
  const saved =
    savedId === undefined
      ? undefined
      : listed.find((job) => job.job_id === savedId);
  if (saved && saved.settings.tags?.alchemy_instance !== instanceId)
    throw new Error("Job ownership tag changed for job " + savedId);
  return matches[0];
}

export const jobProvider = Provider.succeed(SqlJob, {
  diff: ({ olds, news }) =>
    Effect.succeed(
      isResolved(news) && olds.host !== news.host
        ? { action: "replace" as const }
        : undefined,
    ),
  reconcile: ({ news, olds, output, instanceId }) =>
    operation(async () => {
      if (olds && olds.host !== news.host)
        throw new Error(
          "Use a separate stage for a different Databricks workspace",
        );
      const settings = {
        ...news.settings,
        tags: { alchemy_instance: instanceId },
      };
      const existing = await ownedJob(
        news.host,
        settings.name,
        instanceId,
        output?.jobId,
      );
      if (existing) {
        await cli(news.host, ["jobs", "reset"], {
          job_id: existing.job_id,
          new_settings: settings,
        });
        return { jobId: existing.job_id };
      }
      const result = await cli(news.host, ["jobs", "create"], settings);
      return {
        jobId: Schema.decodeUnknownSync(jobId)(JSON.parse(result)).job_id,
      };
    }),
  delete: ({ olds, output, instanceId }) =>
    operation(async () => {
      const job = await ownedJob(
        olds.host,
        olds.settings.name,
        instanceId,
        output.jobId,
      );
      if (job) await cli(olds.host, ["jobs", "delete", String(job.job_id)]);
    }),
});
