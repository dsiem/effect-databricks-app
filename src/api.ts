import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import {
  Filters,
  GenieInput,
  GenieOperation,
  GenieProgress,
  GenieReply,
  Metadata,
  Note,
  NoteInput,
  Notes,
  Overview,
  Status,
  TripSearch,
  Trips,
} from "./domain.js";

const errorBody = <S extends Schema.Top>(code: S, status: number) =>
  Schema.Struct({
    error: Schema.Struct({ code, message: Schema.String }),
  }).pipe(HttpApiSchema.status(status));

export const InvalidRequestBody = errorBody(
  Schema.Literal("invalid_request"),
  400,
);
const NotFoundBody = errorBody(Schema.Literal("note_not_found"), 404);
const GenieFailedBody = errorBody(
  Schema.Literal("genie_message_unavailable"),
  409,
);
const UnavailableBody = errorBody(
  Schema.TemplateLiteral([Schema.String, "_unavailable"]),
  503,
);
const UpstreamBody = errorBody(
  Schema.TemplateLiteral([Schema.String, "_request_failed"]),
  502,
);
const TimeoutBody = errorBody(
  Schema.TemplateLiteral([Schema.String, "_timeout"]),
  504,
);
const errors = [
  InvalidRequestBody,
  NotFoundBody,
  GenieFailedBody,
  UnavailableBody,
  UpstreamBody,
  TimeoutBody,
] as const;
export const ApiError = Schema.Union(errors);

export const invalidRequestBody = (): typeof InvalidRequestBody.Type => ({
  error: {
    code: "invalid_request",
    message: "Check the request fields, dates, and ZIP code.",
  },
});

// Server-only middleware implementation lives at the HTTP boundary in routes.ts.
export class ApiBoundary extends HttpApiMiddleware.Service<ApiBoundary>()(
  "app/ApiBoundary",
  {
    error: errors,
  },
) {}

export const AppApi = HttpApi.make("taxi").add(
  HttpApiGroup.make("app")
    .add(
      HttpApiEndpoint.get("health", "/health", {
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      }),
      HttpApiEndpoint.get("status", "/api/status", { success: Status }),
      HttpApiEndpoint.get("metadata", "/api/metadata", { success: Metadata }),
      HttpApiEndpoint.get("overview", "/api/overview", {
        query: Filters,
        success: Overview,
      }),
      HttpApiEndpoint.get("trips", "/api/trips", {
        query: TripSearch,
        success: Trips,
      }),
      HttpApiEndpoint.post("submitGenie", "/api/genie", {
        payload: GenieInput,
        success: GenieOperation,
      }),
      HttpApiEndpoint.get(
        "pollGenie",
        "/api/genie/:conversationId/messages/:messageId",
        {
          params: GenieOperation,
          success: GenieProgress,
        },
      ),
      HttpApiEndpoint.get(
        "genieResult",
        "/api/genie/:conversationId/messages/:messageId/result",
        {
          params: GenieOperation,
          success: GenieReply,
        },
      ),
      HttpApiEndpoint.get("notes", "/api/notes", { success: Notes }),
      HttpApiEndpoint.put("saveNote", "/api/notes", {
        payload: NoteInput,
        success: Note,
      }),
      HttpApiEndpoint.delete("removeNote", "/api/notes/:id", {
        params: { id: NoteInput.fields.id },
        success: Schema.Struct({ deleted: Schema.Literal(true) }),
      }),
    )
    .middleware(ApiBoundary),
);
