// Conversion of the documentation's type notation to LuaLS type expressions.
//
// The docs use a loose notation: "String", "Int?", "[ NPCEntity ]",
// "Bool/Int/Float/String/Table", "function (key : String) -> Bool",
// "{ Int -> [ Uint16 ] }" (map), "(Int, Int)" (tuple) and so on.
// Everything here is a pure function so the output is deterministic.

import type { Param } from "./types.js";

const PRIMITIVES: Record<string, string> = {
  string: "string",
  int: "integer",
  integer: "integer",
  uint: "integer",
  uint8: "integer",
  uint16: "integer",
  uint32: "integer",
  uint64: "integer",
  int8: "integer",
  int16: "integer",
  int32: "integer",
  int64: "integer",
  long: "integer",
  short: "integer",
  byte: "integer",
  float: "number",
  double: "number",
  number: "number",
  bool: "boolean",
  boolean: "boolean",
  table: "table",
  nil: "nil",
  any: "any",
  void: "nil",
  function: "function",
};

const PRIMITIVE_OUTPUTS = new Set(Object.values(PRIMITIVES));

/** Split on a separator that appears at nesting depth zero (not inside (), [], <> or {}). */
export function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(" || ch === "[" || ch === "<" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === ">" || ch === "}") depth--;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export interface ConvertedType {
  type: string;
  optional: boolean;
  /** Non-primitive type names that must be resolved against known classes. */
  references: string[];
  /** True when the input was prose rather than a type expression. */
  malformed: boolean;
}

/** Lua reserved words cannot be parameter names; suffix them. */
const RESERVED = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in",
  "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
]);

export function sanitiseName(name: string): string {
  let clean = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (clean === "" || /^[0-9]/.test(clean)) clean = "_" + clean;
  if (RESERVED.has(clean)) clean = clean + "_";
  return clean;
}

/** Parse "name : Type" parameter text into a Param. */
export function parseParam(text: string): Param {
  const trimmed = text.trim();
  if (trimmed === "...") return { name: "...", type: "any", optional: false, vararg: true };
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    return { name: sanitiseName(trimmed), type: "any", optional: false, vararg: false };
  }
  const name = sanitiseName(trimmed.slice(0, colon).trim());
  const typeText = trimmed.slice(colon + 1).trim();
  if (typeText === "...") return { name, type: "any", optional: false, vararg: true };
  const converted = convertType(typeText);
  return { name, type: converted.type, optional: converted.optional, vararg: false };
}

/** Render a parameter list as it appears inside a LuaLS "fun(...)" type. */
export function renderFunParams(params: Param[]): string {
  return params
    .map((p) => (p.vararg ? "..." : `${p.name}${p.optional ? "?" : ""}: ${p.type}`))
    .join(", ");
}

/** Render a full LuaLS function type. */
export function renderFunType(params: Param[], returns: string[]): string {
  const ret = returns.length > 0 ? `: ${returns.join(", ")}` : "";
  return `fun(${renderFunParams(params)})${ret}`;
}

/** Convert the text after "->" into zero or more LuaLS return types. */
export function convertReturns(text: string | undefined): { types: string[]; references: string[]; malformed: boolean } {
  if (!text || text.trim() === "") return { types: [], references: [], malformed: false };
  let body = text.trim();
  if (/^\(.*\)$/.test(body) && splitTopLevel(body.slice(1, -1), ",").length > 1) body = body.slice(1, -1);
  const parts = splitTopLevel(body, ",");
  const converted = parts.map((p) => convertType(p));
  return {
    types: converted.map((c) => optionalType(c.type, c.optional)),
    references: dedupe(converted.flatMap((c) => c.references)),
    malformed: converted.some((c) => c.malformed),
  };
}

/** Parse "function (a : T, b : U) -> R" or "function? (self : X)" into a LuaLS fun type. */
function convertFunctionType(text: string): ConvertedType {
  const m = /^function(\?)?\s*(?:\((.*)\))?\s*(?:->\s*(.+))?$/s.exec(text.trim());
  if (!m) return { type: "function", optional: false, references: [], malformed: false };
  const optional = Boolean(m[1]);
  const params = splitTopLevel(m[2] ?? "", ",").map(parseParam);
  const references = params.flatMap((p) => collectReferences(p.type));
  const returns = convertReturns(m[3]);
  references.push(...returns.references);
  return { type: renderFunType(params, returns.types), optional, references: dedupe(references), malformed: false };
}

/** Extract identifier-like type references from a converted LuaLS type string. */
export function collectReferences(luaType: string): string[] {
  const refs = new Set<string>();
  // Strip the "fun(" keyword and parameter names ("name:" / "name?:") before scanning.
  const stripped = luaType.replace(/\bfun\(/g, "(").replace(/[A-Za-z_][A-Za-z0-9_]*\??\s*:/g, "");
  for (const token of stripped.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) {
    if (PRIMITIVE_OUTPUTS.has(token)) continue;
    refs.add(token);
  }
  return [...refs];
}

/** Convert one docs type expression to a LuaLS type. */
export function convertType(input: string): ConvertedType {
  let text = input.replace(/\s+/g, " ").trim();
  if (text === "" || text === "?" || text.toLowerCase() === "unknown" || text === "..." || text === "-") {
    return { type: "any", optional: false, references: [], malformed: false };
  }

  if (/^function\b/.test(text)) return convertFunctionType(text);

  let optional = false;
  if (text.endsWith("?")) {
    optional = true;
    text = text.slice(0, -1).trim();
  }

  // Map notation "{ K -> V }"
  const map = /^\{\s*(.+?)\s*->\s*(.+?)\s*\}$/.exec(text);
  if (map) {
    const key = convertType(map[1]!);
    const value = convertType(map[2]!);
    return {
      type: `table<${key.type}, ${value.type}>`,
      optional,
      references: dedupe([...key.references, ...value.references]),
      malformed: key.malformed || value.malformed,
    };
  }

  // Array "[ X ]" or tuple "[ A, B ]"
  const arr = /^\[\s*(.+?)\s*\]$/.exec(text);
  if (arr) {
    const parts = splitTopLevel(arr[1]!, ",");
    if (parts.length > 1) return tupleType(parts, optional);
    const inner = convertType(arr[1]!);
    return {
      type: `${wrapIfUnion(inner.type)}[]`,
      optional,
      references: inner.references,
      malformed: inner.malformed,
    };
  }

  // Tuple written with parentheses "(Int, Int)" or bare "Integer,Integer"
  const paren = /^\(\s*(.+?)\s*\)$/.exec(text);
  if (paren) {
    const parts = splitTopLevel(paren[1]!, ",");
    if (parts.length > 1) return tupleType(parts, optional);
    text = paren[1]!;
  }
  const bareTuple = splitTopLevel(text, ",");
  if (bareTuple.length > 1) return tupleType(bareTuple, optional);

  // Unions written with "/" or "|" (multi-line cells are joined with "/" upstream).
  const unionParts = splitTopLevel(text.replace(/\|/g, "/"), "/");
  if (unionParts.length > 1) {
    const converted = unionParts.map((p) => convertType(p));
    return {
      type: dedupe(converted.map((c) => c.type)).join("|"),
      optional: optional || converted.some((c) => c.optional),
      references: dedupe(converted.flatMap((c) => c.references)),
      malformed: converted.some((c) => c.malformed),
    };
  }

  // Generic markers like Component<T>: drop the type argument.
  text = text.replace(/<[^>]*>/g, "").trim();

  const primitive = PRIMITIVES[text.toLowerCase()];
  if (primitive) return { type: primitive, optional, references: [], malformed: false };

  // "Combo Entry" style names: collapse the space when the result is an identifier.
  const collapsed = text.replace(/\s+/g, "");
  if (collapsed !== text && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(collapsed) && text.split(" ").length <= 3) {
    text = collapsed;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(text)) {
    return { type: "any", optional, references: [], malformed: true };
  }
  return { type: text, optional, references: [text], malformed: false };
}

function tupleType(parts: string[], optional: boolean): ConvertedType {
  const converted = parts.map((p) => convertType(p));
  return {
    type: `[${converted.map((c) => optionalType(c.type, c.optional)).join(", ")}]`,
    optional,
    references: dedupe(converted.flatMap((c) => c.references)),
    malformed: converted.some((c) => c.malformed),
  };
}

export function wrapIfUnion(type: string): string {
  return type.includes("|") ? `(${type})` : type;
}

export function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Render an optional return or field type. */
export function optionalType(type: string, optional: boolean): string {
  if (!optional) return type;
  if (type === "any" || type === "nil") return type;
  return `${wrapIfUnion(type)}?`;
}
