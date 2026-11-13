import { Schema } from "effect";
import {
  AuthenticationError,
  AuthorizationError,
  ConnectionError,
  SqlError,
  SqlSyntaxError,
  StatementTimeoutError,
  UnknownError,
} from "effect/sql/SqlError";

// Projection of the documented Statement Execution API response. Unknown fields
// are intentionally ignored so additive server changes do not break the driver.
// https://docs.databricks.com/api/statement-execution/v1/statement-execution
const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const StatementId = Schema.NonEmptyString.pipe(
  Schema.brand("DatabricksStatementId"),
);
export const ResultChunk = Schema.Struct({
  external_links: Schema.optional(
    Schema.Array(
      Schema.Struct({
        chunk_index: Index,
        external_link: Schema.NonEmptyString,
      }),
    ),
  ),
});
export const StatementResponse = Schema.Struct({
  statement_id: StatementId,
  status: Schema.Struct({
    state: Schema.Literals([
      "PENDING",
      "RUNNING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "CLOSED",
    ]),
    error: Schema.optional(
      Schema.Struct({
        error_code: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    ),
    sql_state: Schema.optional(Schema.String),
  }),
  manifest: Schema.optional(
    Schema.Struct({
      format: Schema.String,
      total_chunk_count: Index,
      truncated: Schema.optional(Schema.Boolean),
    }),
  ),
  result: Schema.optional(ResultChunk),
});
export type StatementResponse = typeof StatementResponse.Type;
export type ResultChunk = typeof ResultChunk.Type;

export const failure = (message: string, operation: string) =>
  new SqlError({
    reason: new UnknownError({ cause: undefined, message, operation }),
  });

export const timeout = (operation: string) =>
  new SqlError({
    reason: new StatementTimeoutError({
      cause: undefined,
      message: `Databricks ${operation} timed out`,
      operation,
    }),
  });

export const httpFailure = (status: number, operation: string) => {
  const props = {
    cause: undefined,
    message: `Databricks ${operation} returned HTTP ${status}`,
    operation,
  };
  return new SqlError({
    reason:
      status === 401
        ? new AuthenticationError(props)
        : status === 403
          ? new AuthorizationError(props)
          : status === 408 || status === 504
            ? new StatementTimeoutError(props)
            : status === 429 || status >= 500
              ? new ConnectionError(props)
              : new UnknownError(props),
  });
};

export const statementFailure = (status: StatementResponse["status"]) => {
  const props = {
    cause: undefined,
    message: status.error?.message ?? `Databricks statement ${status.state}`,
    operation: "execute",
  };
  const code = status.error?.error_code;
  return new SqlError({
    reason:
      code === "UNAUTHENTICATED"
        ? new AuthenticationError(props)
        : code === "PERMISSION_DENIED" || status.sql_state?.startsWith("425")
          ? new AuthorizationError(props)
          : status.sql_state?.startsWith("42")
            ? new SqlSyntaxError(props)
            : code === "DEADLINE_EXCEEDED"
              ? new StatementTimeoutError(props)
              : new UnknownError(props),
  });
};

/** Permit HTTP only for local development; never embed credentials in URLs. */
export const parseUrl = (
  value: string,
  allowDatabricksStorageProxy = false,
): URL => {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const managedProxy =
    allowDatabricksStorageProxy &&
    url.hostname === "storage-proxy.databricks.com" &&
    !url.port;
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && (loopback || managedProxy))) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "Expected HTTPS URL without embedded credentials or fragment",
    );
  }
  return url;
};

export class TypedParameter {
  constructor(
    readonly type: string,
    readonly value: string | null,
  ) {}
}

export const parameter = (value: unknown, index: number) => {
  const name = `p${index + 1}`;
  if (value instanceof TypedParameter) {
    return { name, type: value.type, value: value.value };
  }
  if (value === null || value === undefined) {
    return { name, type: "STRING", value: null };
  }
  switch (typeof value) {
    case "string":
      return { name, type: "STRING", value };
    case "boolean":
      return { name, type: "BOOLEAN", value: String(value) };
    case "bigint":
      return { name, type: "BIGINT", value: String(value) };
    case "number":
      if (
        !Number.isFinite(value) ||
        (Number.isInteger(value) && !Number.isSafeInteger(value))
      ) {
        throw new Error(
          "Use bigint or an explicit typed parameter for large integers",
        );
      }
      return {
        name,
        type: Number.isInteger(value) ? "BIGINT" : "DOUBLE",
        value: String(value),
      };
    default:
      if (value instanceof Date && Number.isFinite(value.getTime())) {
        return { name, type: "TIMESTAMP", value: value.toISOString() };
      }
      throw new Error(
        "Unsupported Databricks parameter; use sql.param(type, stringValue)",
      );
  }
};
