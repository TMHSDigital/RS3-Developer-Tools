// Data model shared by the parser, the resolver, and the emitter.

/** A Lua type expression in LuaLS syntax, for example "integer" or "NPCEntity[]". */
export type LuaType = string;

export interface Param {
  name: string;
  type: LuaType;
  optional: boolean;
  vararg: boolean;
}

export interface FunctionSig {
  /** Owner table or class, for example "PersistentDB" or "ui.Button". Empty for free functions. */
  owner: string;
  /** "." for static functions, ":" for methods, "" for free functions. */
  sep: "." | ":" | "";
  name: string;
  params: Param[];
  /** Return types from the signature line (already converted to LuaLS syntax). */
  returns: LuaType[];
  /** Return types from the "Returns | Description" table, when the page has one. */
  tableReturns?: LuaType[];
  /** Alternative parameter lists when the docs list several signatures under one heading. */
  overloads: { params: Param[]; returns: LuaType[] }[];
  /** Anchor of the heading the signature was found under. */
  anchor: string;
  /** Raw first signature line as printed in the docs (kept for the index, not for stubs). */
  raw: string;
}

export interface Field {
  name: string;
  type: LuaType;
  anchor: string;
}

export interface IndexSignature {
  keyType: LuaType;
  valueType: LuaType;
  anchor: string;
}

export interface ClassDef {
  name: string;
  parent?: string;
  fields: Field[];
  methods: FunctionSig[];
  index?: IndexSignature;
  /** True when the docs show the name used as a table (NPCList.All(), PersistentDB:Get()). */
  isGlobal: boolean;
  anchor: string;
}

export interface EnumDef {
  name: string;
  /** Member names with their integer value when the docs list one. */
  members: { name: string; value?: number }[];
  anchor: string;
}

export interface EventDef {
  name: string;
  /** Payload fields; empty when the event has no payload. */
  payload: Field[];
  /** Whether the callback must return a boolean (EntityDraw). */
  returnsBoolean: boolean;
  anchor: string;
}

export interface HookDef {
  name: string;
  /** Callback parameter lists; several when the docs list variants for different components. */
  variants: Param[][];
  anchor: string;
}

export type NoteKind =
  | "unparsed-signature"
  | "unresolved-type"
  | "owner-normalised"
  | "name-from-heading"
  | "return-mismatch"
  | "malformed-type-cell"
  | "member-without-signature"
  | "override-applied"
  | "inferred-from-example";

export interface Note {
  kind: NoteKind;
  page: string;
  anchor?: string;
  detail: string;
}

export interface ModuleDef {
  /** Docs path without extension, for example "core/persistentdb". */
  id: string;
  /** Page title as shown in the browser tab, minus the site suffix. */
  title: string;
  url: string;
  classes: ClassDef[];
  freeFunctions: FunctionSig[];
  enums: EnumDef[];
  events: EventDef[];
  hooks: HookDef[];
  notes: Note[];
}

export interface GlobalTables {
  /** config.<Name> to value class name, or "any" when no matching config class exists. */
  config: Record<string, string>;
  /** id.<Name> tables of string to integer. */
  id: string[];
  /** var.<Domain> tables of string to VarType. */
  var: string[];
}

export interface IndexEntry {
  name: string;
  kind:
    | "class"
    | "function"
    | "method"
    | "field"
    | "enum"
    | "enum-member"
    | "event"
    | "hook"
    | "global-table";
  module: string;
  file: string;
  url: string;
  signature: string;
}

export interface GenerateResult {
  modules: ModuleDef[];
  /** Output path (forward slashes, relative to the output root) to file content. */
  files: Record<string, string>;
  index: IndexEntry[];
  notes: Note[];
}
