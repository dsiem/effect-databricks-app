import { DatePicker } from "@foldkit/ui";
import { Option, Schema } from "effect";
import { AsyncData, Command, type Update } from "foldkit";
import { AnalysisInput } from "../../../../shared/analysis-runs";
import type { ApiClient } from "../../lib/api-client";
import { isoDay } from "../../lib/format";
import { empty, pending } from "../../lib/request-state";
import * as Commands from "./commands";
import { focusWeek } from "./dates";
import { Message as M, type Message } from "./messages";
import { type AnalysisRunLink, type Model, readyToSubmit } from "./model";

type Change = Update.Return<Model, Message, ApiClient>;

const editField = (
  model: Model,
  field: keyof Model["draft"],
  value: string,
): Model => ({
  ...model,
  draft: { ...model.draft, [field]: value },
  submission: readyToSubmit(),
});

function loadHistory(model: Model): Change {
  const generation = model.historyGeneration + 1;
  return {
    model: {
      ...model,
      historyGeneration: generation,
      recent: Option.getOrElse(
        AsyncData.revalidateOrLoad(model.recent),
        () => model.recent,
      ),
    },
    commands: [Commands.LoadHistory({ generation })],
  };
}

export function openAnalysisRuns(model: Model, run: AnalysisRunLink): Change {
  const generation = model.generation + 1;
  return loadHistory({
    ...model,
    generation,
    invalidLink: run._tag === "InvalidRun",
    selected:
      run._tag !== "SelectedRun"
        ? null
        : {
            id: run.id,
            generation,
            detail: pending,
            report: empty,
            observedAt: 0,
          },
  });
}

const loadReport = (
  model: Model,
  selected: NonNullable<Model["selected"]>,
): Change => ({
  model: { ...model, selected: { ...selected, report: pending } },
  commands: [
    Commands.LoadReport({ id: selected.id, generation: selected.generation }),
  ],
});

export function updateAnalysisRuns(
  model: Model,
  message: Message,
  query: string | null,
): Change {
  if (query === null && message._tag !== "AnalysisSubmitted") return { model };
  const selected = model.selected;
  switch (message._tag) {
    case "Idle":
      return { model };
    case "AnalysisDatePicker": {
      if (!model.datePickers || model.submission._tag === "Submitting")
        return { model };
      const { field } = message;
      const previous = model.datePickers[field];
      const changed = DatePicker.update(previous, message.message);
      const out = changed.outMessage;
      const closed =
        out?._tag === "ClearedDate" ? DatePicker.close(changed.model) : null;
      const picker =
        !previous.popover.isOpen && changed.model.popover.isOpen
          ? focusWeek(changed.model, model.draft[field])
          : (closed?.model ?? changed.model);
      const next = {
        ...model,
        datePickers: { ...model.datePickers, [field]: picker },
      };
      return {
        model: out
          ? editField(
              next,
              field,
              out._tag === "SelectedDate" ? isoDay(out.date) : "",
            )
          : next,
        commands: [
          ...(changed.commands ?? []),
          ...(closed?.commands ?? []),
        ].map((command) =>
          Command.mapMessage(command, (message) =>
            M.AnalysisDatePicker({ field, message }),
          ),
        ),
      };
    }
    case "AnalysisFieldChanged":
      if (model.submission._tag === "Submitting") return { model };
      return { model: editField(model, message.field, message.value) };
    case "StartAnalysis": {
      if (model.submission._tag === "Submitting") return { model };
      const input = Schema.decodeUnknownOption(AnalysisInput)({
        ...model.draft,
        minimumTrips: Number(model.draft.minimumTrips),
      });
      if (input._tag === "None") {
        return {
          model: {
            ...model,
            submission: readyToSubmit(
              null,
              "Enter two valid week starts and a positive whole number of trips.",
            ),
          },
        };
      }
      const generation = model.generation;
      return {
        model: { ...model, submission: { _tag: "Submitting", generation } },
        commands: [
          Commands.Submit({
            input: input.value,
            retryId: model.submission.retryId,
            generation,
          }),
        ],
      };
    }
    case "AnalysisSubmitted": {
      if (
        model.submission._tag !== "Submitting" ||
        model.submission.generation !== message.generation
      ) {
        return { model };
      }
      if (!message.data) {
        return {
          model: {
            ...model,
            submission: readyToSubmit(message.requestId, message.error),
          },
        };
      }
      const next = { ...model, submission: readyToSubmit() };
      if (query === null) return { model: next };
      if (model.generation !== message.generation) return loadHistory(next);
      return {
        model: next,
        commands: [Commands.OpenRun({ id: message.data.id, query })],
      };
    }
    case "RefreshAnalysisHistory":
      return AsyncData.isPending(model.recent) ? { model } : loadHistory(model);
    case "LoadedAnalysisHistory":
      if (message.generation !== model.historyGeneration) return { model };
      return {
        model: {
          ...model,
          recent: AsyncData.settle(model.recent, message.result),
        },
      };
    case "RetryAnalysisStatus":
      if (!selected || selected.detail.loading) return { model };
      return {
        model: {
          ...model,
          selected: {
            ...selected,
            detail: { ...selected.detail, error: "", loading: true },
          },
        },
      };
    case "LoadedAnalysisStatus": {
      if (
        selected?.id !== message.id ||
        selected.generation !== message.generation
      )
        return { model };
      const next = {
        ...selected,
        detail: {
          data: message.data ?? selected.detail.data,
          error: message.error,
          loading: false,
        },
        observedAt: message.observedAt,
      };
      if (message.data?.state === "succeeded") return loadReport(model, next);
      return { model: { ...model, selected: next } };
    }
    case "RetryAnalysisReport":
      return selected?.detail.data?.state === "succeeded" &&
        !selected.report.loading
        ? loadReport(model, selected)
        : { model };
    case "LoadedAnalysisReport":
      if (
        selected?.id !== message.id ||
        selected.generation !== message.generation
      )
        return { model };
      return {
        model: {
          ...model,
          selected: {
            ...selected,
            report: {
              data: message.data,
              error: message.error,
              loading: false,
            },
          },
        },
      };
    case "ReuseAnalysisInputs":
      if (model.submission._tag === "Submitting") return { model };
      return {
        model: {
          ...model,
          draft: {
            ...message.input,
            minimumTrips: String(message.input.minimumTrips),
          },
          submission: readyToSubmit(),
        },
        commands: [Commands.FocusInputs()],
      };
  }
}
