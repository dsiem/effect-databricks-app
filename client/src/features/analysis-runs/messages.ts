import { DatePicker, Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import {
  AnalysisInput,
  AnalysisRun,
  AnalysisRunReference,
  AnalysisRunSummary,
  RouteReliabilityReport,
} from "../../../../shared/analysis-runs";
import { Id } from "../../../../shared/domain";
import { Selection, WeekField } from "./model";

const messages = {
  OpenAnalysisForm: {},
  CloseAnalysisForm: {},
  AnalysisFormDialog: { message: Dialog.Message },
  AnalysisDatePicker: { field: WeekField, message: DatePicker.Message },
  AnalysisFieldChanged: {
    field: Schema.Literals(["baselineWeek", "comparisonWeek", "minimumTrips"]),
    value: Schema.String,
  },
  StartAnalysis: {},
  AnalysisSubmitted: {
    requestId: Id,
    generation: Schema.Int,
    data: Schema.NullOr(AnalysisRunReference),
    error: Schema.String,
  },
  RefreshAnalysisHistory: {},
  LoadedAnalysisHistory: {
    generation: Schema.Int,
    result: Schema.Result(Schema.Array(AnalysisRunSummary), Schema.String),
  },
  RetryAnalysisStatus: {},
  LoadedAnalysisStatus: {
    ...Selection.fields,
    data: Schema.NullOr(AnalysisRun),
    error: Schema.String,
    observedAt: Schema.Int,
  },
  RetryAnalysisReport: {},
  LoadedAnalysisReport: {
    ...Selection.fields,
    data: Schema.NullOr(RouteReliabilityReport),
    error: Schema.String,
  },
  ReuseAnalysisInputs: { input: AnalysisInput },
};

export const Message = defineMessageUnion({ Idle: {}, ...messages });
export type Message = typeof Message.Type;
