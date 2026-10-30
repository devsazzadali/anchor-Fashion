/**
 * Escape a user-supplied string for use inside a Prisma
 * `contains` / `startsWith` / `endsWith` filter.
 *
 * Prisma translates those filters to a Postgres `LIKE` pattern built
 * from the raw value, and Postgres treats `%` (any run) and `_` (any
 * single character) in the pattern as wildcards — Prisma does NOT
 * escape them. A shopper searching for "%" therefore matched every
 * product (REG-43). Escaping the three LIKE metacharacters
 * (backslash first, then %, then _) makes the value match literally;
 * Postgres' default LIKE escape character is the backslash, which the
 * escaped forms above rely on (verified empirically against the live
 * database: contains "\%" matches only a literal percent sign).
 */
export function escapeLikeWildcards(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
