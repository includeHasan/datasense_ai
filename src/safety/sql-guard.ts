import nodeSqlParser, { type AST } from "node-sql-parser";

const { Parser: SqlParser } = nodeSqlParser;

/**
 * The set of SQL dialects we attempt to parse incoming queries with, in order.
 * A query only needs to parse cleanly under one of these dialects to be
 * considered syntactically valid; we then inspect the resulting AST to make
 * sure it is a single, read-only SELECT statement.
 */
export type SupportedSqlDialect = "postgresql" | "mysql" | "sqlite";

export const CANDIDATE_SQL_DIALECTS: readonly SupportedSqlDialect[] = [
  "postgresql",
  "mysql",
  "sqlite",
];

/**
 * Statement types that are never allowed, regardless of dialect. This list is
 * intentionally defensive (a superset of what node-sql-parser can produce) so
 * that new statement kinds fail closed rather than open.
 */
const FORBIDDEN_STATEMENT_TYPES = new Set([
  "insert",
  "update",
  "delete",
  "replace",
  "drop",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "attach",
  "detach",
  "copy",
  "call",
  "use",
  "rename",
  "lock",
  "unlock",
  "set",
  "exec",
  "execute",
  "merge",
  "comment",
  "proc",
]);

export class UnsafeSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSqlError";
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Asserts that `sql` is exactly one read-only SELECT statement (optionally a
 * `WITH ... SELECT` CTE). Throws an `UnsafeSqlError` with a descriptive
 * message for anything else: multiple statements, DML/DDL statements, or SQL
 * that fails to parse under every supported dialect.
 */
export function assertReadOnlySelect(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new UnsafeSqlError("SQL query is empty.");
  }

  let ast: AST[] | AST | undefined;
  let parsedDialect: SupportedSqlDialect | undefined;
  let lastParseError: unknown;

  for (const dialect of CANDIDATE_SQL_DIALECTS) {
    try {
      const parser = new SqlParser();
      ast = parser.astify(trimmed, { database: dialect });
      parsedDialect = dialect;
      break;
    } catch (error) {
      lastParseError = error;
    }
  }

  if (ast === undefined || parsedDialect === undefined) {
    throw new UnsafeSqlError(
      `Could not parse SQL as a valid statement under any supported dialect ` +
        `(${CANDIDATE_SQL_DIALECTS.join(", ")}). Last error: ${describeError(lastParseError)}`,
    );
  }

  const statements = Array.isArray(ast) ? ast : [ast];

  if (statements.length !== 1) {
    throw new UnsafeSqlError(
      `Only a single SQL statement is allowed; found ${statements.length} statements.`,
    );
  }

  assertStatementIsReadOnlySelect(statements[0], parsedDialect);
}

function assertStatementIsReadOnlySelect(statement: AST, dialect: SupportedSqlDialect): void {
  const type = (statement as { type?: string }).type?.toLowerCase();

  if (!type) {
    throw new UnsafeSqlError("Could not determine the SQL statement type.");
  }

  if (type !== "select") {
    throw new UnsafeSqlError(
      `Only read-only SELECT statements are allowed (optionally with a WITH ... clause). ` +
        `Detected a "${type.toUpperCase()}" statement (parsed as ${dialect}), which is forbidden.`,
    );
  }

  if (FORBIDDEN_STATEMENT_TYPES.has(type)) {
    // Defensive: should be unreachable since only "select" passes the check
    // above, but guards against future AST shape changes.
    throw new UnsafeSqlError(`Statement type "${type}" is forbidden.`);
  }
}
