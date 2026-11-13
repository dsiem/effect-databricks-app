import { Data } from "effect";

export class InvalidRequest extends Data.TaggedError("InvalidRequest")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class NoteNotFound extends Data.TaggedError("NoteNotFound")<{
  readonly id: string;
  readonly message: string;
}> {}

export class NoteConflict extends Data.TaggedError("NoteConflict")<{
  readonly id: string;
  readonly message: string;
}> {}

export class ServiceUnavailable extends Data.TaggedError("ServiceUnavailable")<{
  readonly service: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly service: string;
  readonly message: string;
  readonly upstreamStatus?: number;
  readonly cause?: unknown;
}> {}

export class OperationTimeout extends Data.TaggedError("OperationTimeout")<{
  readonly service: string;
  readonly message: string;
}> {}

export class GenieFailed extends Data.TaggedError("GenieFailed")<{
  readonly status: string;
  readonly message: string;
}> {}

export type ServiceError =
  | InvalidRequest
  | NoteNotFound
  | NoteConflict
  | ServiceUnavailable
  | UpstreamError
  | OperationTimeout
  | GenieFailed;

export const unavailable = (
  service: string,
  message: string,
  cause?: unknown,
) => new ServiceUnavailable({ service, message, cause });
