#!/usr/bin/env node
/**
 * Generates lib/db/field-map.ts from prisma/schema.prisma.
 *
 * The native data layer (lib/db) translates between the database's
 * snake_case column names and Prisma's camelCase model fields using this
 * map. Re-run after every schema change:
 *
 *   node scripts/generate-db-field-map.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "prisma/schema.prisma"), "utf8");

const SCALARS = new Set([
  "String", "Int", "Float", "Decimal", "Boolean", "DateTime", "Json", "BigInt", "Bytes",
]);
const enums = new Set([...src.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]));
const modelNames = new Set([...src.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]));

const models = {};
for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m;
  const table = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name;
  const fields = {};
  const relations = [];
  const uniques = [];
  const cid = body.match(/@@id\(\[([^\]]+)\]\)/);
  const compositeId = cid ? cid[1].split(",").map((s) => s.trim()) : null;
  for (const um of body.matchAll(/@@unique\(\[([^\]]+)\]/g)) {
    uniques.push(um[1].split(",").map((s) => s.trim()));
  }
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const fm = line.match(/^(\w+)\s+([A-Za-z_][\w]*\??(?:\[\])?)\s*(.*)$/);
    if (!fm) continue;
    const [, fname, ftype, attrs] = fm;
    const base = ftype.replace(/\?$/, "").replace(/\[\]$/, "");
    if (modelNames.has(base)) {
      relations.push(fname);
      continue;
    }
    if (!SCALARS.has(base) && !enums.has(base)) continue;
    const col = attrs.match(/@map\("([^"]+)"\)/)?.[1] ?? fname;
    fields[col] = {
      field: fname,
      type: base,
      list: ftype.endsWith("[]"),
      id: attrs.includes("@id"),
      unique: attrs.includes("@unique"),
      updatedAt: attrs.includes("@updatedAt"),
      default: /@default\(/.test(attrs),
    };
    if (attrs.includes("@unique")) uniques.push([fname]);
  }
  models[table] = {
    model: name,
    delegate: name[0].toLowerCase() + name.slice(1),
    fields,
    relations,
    compositeId,
    uniques,
  };
}

const out = `/* GENERATED from prisma/schema.prisma by scripts/generate-db-field-map.mjs — do not edit by hand. */
export interface DbFieldMeta { field: string; type: string; list: boolean; id: boolean; unique: boolean; updatedAt: boolean; default: boolean }
export interface DbTableMeta { model: string; delegate: string; fields: Record<string, DbFieldMeta>; relations: string[]; compositeId: string[] | null; uniques: string[][] }
export const DB_TABLES: Record<string, DbTableMeta> = ${JSON.stringify(models)};
`;
writeFileSync(join(root, "lib/db/field-map.ts"), out);
console.log(
  `field-map written: ${Object.keys(models).length} tables, ` +
    `${Object.values(models).reduce((n, t) => n + Object.keys(t.fields).length, 0)} columns`
);
