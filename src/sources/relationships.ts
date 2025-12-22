import type { SchemaProfile, SchemaRelationship } from "./types.js";

type ProfileTable = SchemaProfile["tables"][number];

/**
 * Very small, defensive pluralizer used only to go from a column's inferred
 * "base" noun (e.g. "customer" from "customer_id") to the table name we'd
 * expect to reference (e.g. "customers"). Only handles the common English
 * cases that show up in practice; anything unusual simply won't match, which
 * is fine because false negatives are preferred over false positives here.
 */
function candidatePlurals(base: string): string[] {
  const lower = base.toLowerCase();
  if (lower.endsWith("s")) return [lower];
  if (/(s|x|z|ch|sh)$/.test(lower)) return [`${lower}es`];
  if (/[^aeiou]y$/.test(lower)) return [`${lower.slice(0, -1)}ies`];
  return [`${lower}s`, lower];
}

/**
 * Extracts the "base noun" a foreign-key-shaped column name refers to, e.g.
 * "customer_id" -> "customer", "customerid" -> "customer" (only when the
 * remaining prefix is non-trivial). Returns undefined for columns that don't
 * look like foreign keys at all (including the primary-key-shaped "id").
 */
function extractForeignKeyBase(columnName: string): string | undefined {
  const lower = columnName.toLowerCase();
  if (lower === "id") return undefined;

  const underscoreMatch = /^(.+)_id$/.exec(lower);
  if (underscoreMatch) {
    const base = underscoreMatch[1];
    return base.length > 0 ? base : undefined;
  }

  // Bare "<word>id" with no underscore (e.g. "customerid"). Require a
  // reasonably long prefix so we don't misfire on short/ambiguous names.
  const bareMatch = /^([a-z]{3,})id$/.exec(lower);
  if (bareMatch) return bareMatch[1];

  return undefined;
}

/** Finds the table whose name matches one of the candidate names, case-insensitively. */
function findTableByName(tables: ProfileTable[], candidates: string[]): ProfileTable | undefined {
  const wanted = new Set(candidates.map((c) => c.toLowerCase()));
  return tables.find((table) => wanted.has(table.name.toLowerCase()));
}

/**
 * Finds a primary-key-shaped column on a table: "id" or "<table>_id" (the SQL
 * convention), or "_id" (MongoDB's convention - every document's real
 * primary key field is literally named "_id", not "id").
 */
function findPrimaryKeyColumn(table: ProfileTable, base: string): { name: string; type: string } | undefined {
  const idColumn = table.columns.find((col) => {
    const lower = col.name.toLowerCase();
    return lower === "id" || lower === "_id";
  });
  if (idColumn) return idColumn;

  const namedColumn = table.columns.find(
    (col) => col.name.toLowerCase() === `${base.toLowerCase()}_id` || col.name.toLowerCase() === `${base.toLowerCase()}id`,
  );
  if (namedColumn) return namedColumn;

  return undefined;
}

/** Coarse type family used to sanity-check that a candidate FK/PK pair are compatible. */
function typeFamily(type: string): "numeric" | "text" | "other" {
  const lower = type.toLowerCase();
  if (/(int|serial|numeric|decimal|float|double|real)/.test(lower)) return "numeric";
  if (/(char|text|string|uuid|varchar)/.test(lower)) return "text";
  return "other";
}

/**
 * Cheap corroboration signal: do the sampled values of the candidate FK
 * column show up among the sampled values of the candidate referenced
 * column? With only a handful of sample rows on each side this is a weak
 * signal (may legitimately be 0 even for a real relationship), so it is used
 * only to boost confidence in ambiguous logging/debugging, never to gate
 * emitting a relationship that already passed the naming + type checks.
 */
function hasSampleValueOverlap(
  fromRows: Record<string, unknown>[],
  fromColumn: string,
  toRows: Record<string, unknown>[],
  toColumn: string,
): boolean {
  const toValues = new Set(
    toRows.map((row) => row[toColumn]).filter((v) => v !== null && v !== undefined).map(String),
  );
  if (toValues.size === 0) return false;
  return fromRows.some((row) => {
    const value = row[fromColumn];
    return value !== null && value !== undefined && toValues.has(String(value));
  });
}

/**
 * Heuristically infers foreign-key-like relationships from column naming
 * conventions, for sources with no queryable FK constraint metadata (e.g.
 * DuckDB tables created from an uploaded flat file). Deliberately
 * conservative: only emits a relationship when the naming match is
 * unambiguous and a plausible primary-key column exists on the referenced
 * table with a compatible type. Missing a real relationship is preferred
 * over fabricating a wrong one.
 */
export function inferRelationships(tables: ProfileTable[]): SchemaRelationship[] {
  const relationships: SchemaRelationship[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    for (const column of table.columns) {
      const base = extractForeignKeyBase(column.name);
      if (!base) continue;

      const candidateNames = [...candidatePlurals(base), base];
      const referencedTable = findTableByName(tables, candidateNames);
      if (!referencedTable) continue;

      const pkColumn = findPrimaryKeyColumn(referencedTable, base);
      if (!pkColumn) continue;

      if (typeFamily(column.type) !== typeFamily(pkColumn.type)) continue;

      // Self-match on the exact same column (not a real relationship).
      if (referencedTable === table && pkColumn.name === column.name) continue;

      const key = `${table.name}.${column.name}->${referencedTable.name}.${pkColumn.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Corroboration is informative but not required (see doc comment above).
      hasSampleValueOverlap(table.sampleRows, column.name, referencedTable.sampleRows, pkColumn.name);

      relationships.push({
        fromTable: table.name,
        fromColumn: column.name,
        toTable: referencedTable.name,
        toColumn: pkColumn.name,
        confidence: "inferred",
      });
    }
  }

  return relationships;
}
