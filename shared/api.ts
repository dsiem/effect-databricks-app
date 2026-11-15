import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import {
  CurrentUser,
  Filters,
  GenieInput,
  GenieOperation,
  GenieProgress,
  GenieReply,
  GpsActivity,
  GpsSearch,
  Metadata,
  Overview,
  SavedView,
  SavedViewInput,
  SavedViewPin,
  SavedViewSearch,
  SavedViewsPage,
  Status,
  TripComment,
  TripCommentCountSearch,
  TripCommentCounts,
  TripCommentInput,
  TripCommentSearch,
  TripComments,
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
const NotFoundBody = errorBody(Schema.Literal("saved_view_not_found"), 404);
const SavedViewConflictBody = errorBody(
  Schema.Literal("saved_view_conflict"),
  409,
);
const GenieFailedBody = errorBody(
  Schema.Literal("genie_message_unavailable"),
  409,
);
const UnavailableBody = errorBody(
  Schema.TemplateLiteral([Schema.String, "_unavailable"]),
  503,
);
const UpstreamBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.TemplateLiteral([Schema.String, "_request_failed"]),
    message: Schema.String,
    upstreamStatus: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 400, maximum: 599 })),
    ),
  }),
}).pipe(HttpApiSchema.status(502));
const TimeoutBody = errorBody(
  Schema.TemplateLiteral([Schema.String, "_timeout"]),
  504,
);
const errors = [
  InvalidRequestBody,
  NotFoundBody,
  SavedViewConflictBody,
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
      HttpApiEndpoint.get("currentUser", "/api/me", {
        success: Schema.NullOr(CurrentUser),
      }),
      HttpApiEndpoint.get("metadata", "/api/metadata", { success: Metadata }),
      HttpApiEndpoint.get("overview", "/api/overview", {
        query: Filters,
        success: Overview,
      }),
      HttpApiEndpoint.get("trips", "/api/trips", {
        query: TripSearch,
        success: Trips,
      }),
      HttpApiEndpoint.get("gpsActivity", "/api/gps-activity", {
        query: GpsSearch,
        success: GpsActivity,
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
      HttpApiEndpoint.get("savedViews", "/api/saved-views", {
        query: SavedViewSearch,
        success: SavedViewsPage,
      }),
      HttpApiEndpoint.get("tripComments", "/api/trip-comments", {
        query: TripCommentSearch,
        success: TripComments,
      }),
      HttpApiEndpoint.get("tripCommentCounts", "/api/trip-comment-counts", {
        query: TripCommentCountSearch,
        success: TripCommentCounts,
      }),
      HttpApiEndpoint.post("addTripComment", "/api/trip-comments", {
        payload: TripCommentInput,
        success: TripComment,
      }),
      HttpApiEndpoint.put("saveSavedView", "/api/saved-views", {
        payload: SavedViewInput,
        success: SavedView,
      }),
      HttpApiEndpoint.patch("pinSavedView", "/api/saved-views/:id/pin", {
        params: { id: SavedViewInput.fields.id },
        payload: SavedViewPin,
        success: SavedView,
      }),
      HttpApiEndpoint.delete("removeSavedView", "/api/saved-views/:id", {
        params: { id: SavedViewInput.fields.id },
        query: {
          version: Schema.NumberFromString.check(
            Schema.isInt(),
            Schema.isGreaterThan(0),
          ),
        },
        success: Schema.Struct({ deleted: Schema.Literal(true) }),
      }),
    )
    .middleware(ApiBoundary),
);
