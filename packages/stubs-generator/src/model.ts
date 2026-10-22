// Builds the API model for one documentation page from its parsed blocks.
//
// The rules here mirror how the docs are laid out: an H3 (or H4) heading per
// member, a Lua code block holding the signature, a "Parameter | Type |
// Description" table, a "Returns | Description" table, and "Name | Type |
// Description" tables for properties. Anything that does not fit one of the
// recognised shapes is recorded as a note and surfaces in unresolved.md
// instead of being guessed.

import type { Block, Heading, ParsedPage, TableBlock } from "./parse.js";
import { stripAngleBrackets } from "./lua-types.js";
import {
  convertReturns,
  convertType,
  looksLikeIdentifierPath,
  parseParam,
  splitTopLevel,
} from "./lua-types-extra.js";
import type {
  ClassDef,
  EnumDef,
  EventDef,
  Field,
  FunctionSig,
  HookDef,
  ModuleDef,
  Note,
  Param,
} from "./types.js";

/** Headings that name a section of a page rather than a type or a member. */
const SECTION_WORDS = new Set(
  [
    "overview", "example", "examples", "methods", "method", "properties", "property", "functions",
    "function", "constructors", "constructor", "enumerations", "enumeration", "types", "type",
    "requirements", "usage", "index", "custom visuals", "restricted components", "handling events",
    "positioning and layout", "visual properties", "state properties", "interface properties",
    "supported events", "event payloads", "common methods and properties", "methods and properties",
    "key codes", "plugin resources", "drawing shapes", "shapes", "accessing the minimenu",
    "prerequisites and requirements", "common modfiers", "common modifiers", "image layout",
    "recommend built-in styles", "associated enumerations", "component state change events",
    "mouse and keyboard events", "touch gesture events", "controller events", "action events",
    "transmission events", "miscellaneous events",
  ].map((s) => s.toLowerCase()),
);

// Headings are whitespace-normalised before matching so the pattern needs no
// unbounded whitespace quantifier (CodeQL js/polynomial-redos).
const SECTION_SUFFIX = / (Properties|Methods|Functions|Enumerations|Constructors)$/;

export interface PageScan {
  /** Identifiers used as tables in code, e.g. "NPCList", "ui.Button", "game.options". */
  usedTables: string[];
  configTables: string[];
  idTables: string[];
  varTables: string[];
  /** Variable domains listed in a "Domain | Description" table (VarType page). */
  varDomains: string[];
}

export interface PageModel {
  module: ModuleDef;
  scan: PageScan;
}

export interface OwnerPlaceholder {
  owner: string;
  class: string;
  table: string;
}

export interface BuildOptions {
  id: string;
  url: string;
  ownerPlaceholders?: OwnerPlaceholder[];
}

interface ParsedSignature {
  kind: "function";
  sig: FunctionSig;
}
interface ParsedIndex {
  kind: "index";
  owner: string;
  keyType: string;
  valueType: string;
  valueOptional: boolean;
  anchor: string;
}
type Parsed = ParsedSignature | ParsedIndex;

const EXAMPLE_ADMONITIONS = new Set(["example", "result", "tip", "question", "quote", "abstract"]);

function innermost(path: Heading[]): Heading | undefined {
  return path[path.length - 1];
}

function headingNamesExample(path: Heading[]): boolean {
  return path.some((h) => /^examples?$/i.test(h.text.trim()));
}

function stripSectionSuffix(text: string): string {
  return collapseWhitespace(text).replace(SECTION_SUFFIX, "").trim();
}

/** Collapse runs of whitespace to one space and trim, so regexes can use single spaces. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}


function isSectionWord(text: string): boolean {
  return SECTION_WORDS.has(text.trim().toLowerCase());
}

/** Join code lines into logical statements: a line continues while parentheses are open. */
function logicalLines(lines: string[]): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (current === "" && (line === "" || line.startsWith("--"))) continue;
    current = current === "" ? line : `${current} ${line}`;
    for (const ch of line) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
    if (depth <= 0) {
      out.push(current.replace(/\s+/g, " ").trim());
      current = "";
      depth = 0;
    }
  }
  if (current) out.push(current.replace(/\s+/g, " ").trim());
  return out;
}

// Signature lines are whitespace-normalised (collapseWhitespace) before these
// run, so every optional gap is a single " ?" and the patterns stay linear.
const SIG_WITH_OWNER = /^function ([A-Za-z_][\w.]*?(?:<[^>]*>)?)([:.])(\w+) ?\((.*)\) ?(?:-> ?(.+?))? ?;?$/;
const SIG_FREE = /^function (\w+) ?\((.*)\) ?(?:-> ?(.+?))? ?;?$/;
const SIG_NO_KEYWORD = /^([A-Z][\w.]*?(?:<[^>]*>)?)([:.])(\w+) ?\((.*)\) ?(?:-> ?(.+?))? ?;?$/;
const SIG_INDEX = /^([A-Za-z_][\w.]*)\[(\w+) ?: ?([^\]]+)\] ?(?:-> ?(.+)|= ?(\w+) ?: ?(.+))?$/;

function makeSig(owner: string, sep: ":" | "." | "", name: string, paramText: string, retText: string | undefined, anchor: string, raw: string): FunctionSig {
  return {
    owner,
    sep,
    name,
    params: splitTopLevel(paramText, ",").map(parseParam),
    returns: convertReturns(retText).types,
    overloads: [],
    anchor,
    raw,
  };
}

function parseSignatureLine(line: string, anchor: string): Parsed | "unparsed" | undefined {
  // The docs occasionally write "ui.function StyleSheets:Contains(...)"; normalise it.
  const text = collapseWhitespace(line).replace(/^(\w+)\.function /, "function $1.");

  let m = SIG_WITH_OWNER.exec(text);
  if (m) return { kind: "function", sig: makeSig(m[1]!, m[2] as ":" | ".", m[3]!, m[4]!, m[5], anchor, line) };
  m = SIG_FREE.exec(text);
  if (m) return { kind: "function", sig: makeSig("", "", m[1]!, m[2]!, m[3], anchor, line) };
  m = SIG_INDEX.exec(text);
  if (m) {
    const converted = convertType(m[4] ?? m[6] ?? "any");
    return {
      kind: "index",
      owner: m[1]!,
      keyType: convertType(m[3]!).type,
      valueType: converted.type,
      valueOptional: converted.optional,
      anchor,
    };
  }
  m = SIG_NO_KEYWORD.exec(text);
  if (m && (m[4]!.trim() === "" || / : /.test(m[4]!))) {
    return { kind: "function", sig: makeSig(m[1]!, m[2] as ":" | ".", m[3]!, m[4]!, m[5], anchor, line) };
  }
  if (/^function\b/.test(text)) return "unparsed";
  return undefined;
}

/** Collect "config.X", "id.X", "var.X" and "Table.member" references from code. */
function scanCode(lines: string[], scan: PageScan): void {
  const text = lines.join("\n");
  for (const m of text.matchAll(/\bconfig\.([A-Z]\w*)\b/g)) scan.configTables.push(m[1]!);
  for (const m of text.matchAll(/\bid\.([A-Z]\w*)\b/g)) scan.idTables.push(m[1]!);
  for (const m of text.matchAll(/\bvar\.([A-Z]\w*)\b/g)) scan.varTables.push(m[1]!);
  for (const m of text.matchAll(/(?<![\w.])([A-Z]\w*)[.:]\w+/g)) scan.usedTables.push(m[1]!);
  for (const m of text.matchAll(/(?<![\w.])([a-z]\w*\.[A-Za-z]\w*)[.:]\w+/g)) scan.usedTables.push(m[1]!);
}

export function buildPageModel(page: ParsedPage, options: BuildOptions): PageModel {
  const notes: Note[] = [];
  const scan: PageScan = { usedTables: [], configTables: [], idTables: [], varTables: [], varDomains: [] };
  const h1 = page.blocks.find((b) => b.kind === "heading" && b.heading.level === 1);
  const h1Text = h1 && h1.kind === "heading" ? h1.heading.text.trim() : "";
  const note = (kind: Note["kind"], detail: string, anchor?: string) =>
    notes.push({ kind, page: options.id, anchor, detail });
  const placeholders = options.ownerPlaceholders ?? [];
  const placeholderTables = new Map<string, string>();

  // Owners written with a placeholder segment ("game.options.<option name>") map to a named class.
  const applyPlaceholder = (owner: string, anchor: string): string => {
    for (const p of placeholders) {
      if (owner === p.owner) {
        placeholderTables.set(p.table, p.class);
        note("override-applied", `owner "${p.owner}" modelled as class ${p.class} stored in ${p.table}`, anchor);
        return p.class;
      }
    }
    return stripAngleBrackets(owner).replace(/\.$/, "");
  };

  // Pass 1: parse every signature and remember which headings own one.
  const parsedByBlock = new Map<Block, Parsed[]>();
  const memberHeadings = new Set<string>();
  const sigsByHeading = new Map<string, FunctionSig[]>();
  for (const block of page.blocks) {
    if (block.kind !== "code") continue;
    scanCode(block.lines, scan);
    if (block.language !== "lua" && block.language !== "") continue;
    if (block.admonition && EXAMPLE_ADMONITIONS.has(block.admonition)) continue;
    if (headingNamesExample(block.path)) continue;
    const heading = innermost(block.path);
    const anchor = heading?.anchor ?? "";
    const parsed: Parsed[] = [];
    for (const line of logicalLines(block.lines)) {
      const result = parseSignatureLine(line, anchor);
      if (result === "unparsed") {
        note("unparsed-signature", line, anchor);
      } else if (result) {
        if (result.kind === "function" && result.sig.owner) result.sig.owner = applyPlaceholder(result.sig.owner, anchor);
        if (result.kind === "index") result.owner = applyPlaceholder(result.owner, anchor);
        parsed.push(result);
      }
    }
    if (parsed.length > 0) {
      parsedByBlock.set(block, parsed);
      if (heading) memberHeadings.add(heading.anchor);
      for (const p of parsed) {
        if (p.kind === "function") {
          const list = sigsByHeading.get(anchor) ?? [];
          list.push(p.sig);
          sigsByHeading.set(anchor, list);
        }
      }
    }
  }

  // A heading names a type when it is an identifier (optionally with a section suffix or
  // a space, as in "Combo Entry"), is not a generic section word, and owns no signature.
  const typeNameOf = (heading: Heading): string | undefined => {
    if (heading.level === 1) return undefined;
    if (memberHeadings.has(heading.anchor)) return undefined;
    if (isSectionWord(heading.text)) return undefined;
    const stripped = stripSectionSuffix(heading.text);
    if (looksLikeIdentifierPath(stripped)) return stripped;
    const collapsed = stripped.replace(/\s+/g, "");
    if (stripped.split(/\s+/).length <= 3 && /^[A-Z]/.test(stripped) && looksLikeIdentifierPath(collapsed)) return collapsed;
    return undefined;
  };
  const typeContext = (path: Heading[]): string | undefined => {
    for (let i = path.length - 1; i >= 0; i--) {
      const name = typeNameOf(path[i]!);
      if (name) return name;
    }
    return undefined;
  };

  // Page class: the H1 when it is an identifier, possibly replaced by a fully-qualified
  // owner used in page-level signatures (H1 "Interface" with "ui.Interface:GetComponent").
  // When the H1 is prose and every page-level signature shares one owner, that owner is used.
  const h1Identifier = looksLikeIdentifierPath(h1Text) ? h1Text : undefined;
  let pageClass = h1Identifier;
  const pageLevelOwners = new Set<string>();
  for (const block of page.blocks) {
    const parsed = parsedByBlock.get(block);
    if (!parsed || typeContext(block.path)) continue;
    for (const p of parsed) {
      const owner = p.kind === "function" ? p.sig.owner : p.owner;
      if (owner) pageLevelOwners.add(owner);
    }
  }
  if (h1Identifier) {
    for (const owner of pageLevelOwners) {
      if (owner !== h1Identifier && owner.endsWith("." + h1Identifier)) pageClass = owner;
    }
  } else if (pageLevelOwners.size === 1) {
    pageClass = [...pageLevelOwners][0];
  }

  const normaliseOwner = (owner: string, path: Heading[], anchor: string): string => {
    const ctx = typeContext(path) ?? pageClass;
    if (!ctx || owner === ctx) return owner;
    if (owner.endsWith("." + ctx)) return owner;
    if (ctx.endsWith("." + owner)) {
      note("owner-normalised", `${owner} -> ${ctx} (signature owner is the unqualified form of the page class)`, anchor);
      return ctx;
    }
    if (ctx.startsWith(owner) && !ctx.includes(".")) {
      note("owner-normalised", `${owner} -> ${ctx} (signature owner is an abbreviation of the page class)`, anchor);
      return ctx;
    }
    return owner;
  };

  const classes = new Map<string, ClassDef>();
  const classOrder: string[] = [];
  const getClass = (name: string, anchor: string): ClassDef => {
    let cls = classes.get(name);
    if (!cls) {
      cls = { name, fields: [], methods: [], isGlobal: false, anchor };
      classes.set(name, cls);
      classOrder.push(name);
    }
    return cls;
  };
  const freeFunctions: FunctionSig[] = [];
  const enums: EnumDef[] = [];
  const events: EventDef[] = [];
  const hooks: HookDef[] = [];
  const isEventsPage = options.id === "core/events";

  // Resolve the class a "Name | Type | Description" table under this path belongs to.
  const propertyClassFor = (path: Heading[]): string | undefined => {
    const ctx = typeContext(path);
    if (ctx) return ctx;
    const h2 = path.find((h) => h.level === 2);
    if (h2) {
      const owners = new Set<string>();
      for (const [anchor, sigs] of sigsByHeading) {
        const belongs = page.blocks.some(
          (b) =>
            b.kind === "heading" &&
            b.heading.anchor === anchor &&
            b.path.some((p) => p.anchor === h2.anchor),
        );
        if (!belongs) continue;
        for (const sig of sigs) if (sig.owner) owners.add(normaliseOwner(sig.owner, path, anchor));
      }
      if (owners.size === 1) return [...owners][0];
    }
    return pageClass;
  };

  // Pass 2: walk blocks in order, attaching tables to the signature or class they describe.
  const lastSigByHeading = new Map<string, FunctionSig>();
  let currentEvent: EventDef | undefined;

  for (const block of page.blocks) {
    if (block.kind === "heading") {
      const heading = block.heading;
      if (isEventsPage && heading.level === 3 && block.path.some((p) => /^supported events$/i.test(p.text))) {
        currentEvent = { name: heading.text.trim(), payload: [], returnsBoolean: false, anchor: heading.anchor };
        events.push(currentEvent);
      } else if (heading.level <= 2) {
        currentEvent = undefined;
      }
      // Lower-case identifier headings with no signature and no table are fields the docs
      // describe in prose only (Plugin.urls, Plugin.resources). Report them.
      if (
        heading.level >= 3 &&
        /^[a-z_]\w*$/.test(heading.text.trim()) &&
        !memberHeadings.has(heading.anchor) &&
        !isSectionWord(heading.text)
      ) {
        const hasTable = page.blocks.some((b) => b.kind === "table" && innermost(b.path)?.anchor === heading.anchor);
        if (!hasTable) note("member-without-signature", `${heading.text} (heading only, no signature or table)`, heading.anchor);
      }
      continue;
    }

    if (block.kind === "para") {
      // Inheritance chains such as "ui.Component -> ui.ComponentCollection -> ui.GroupBox".
      if (/^([\w.]+)(\s*->\s*[\w.]+)+$/.test(block.text.trim())) {
        const parts = block.text.split("->").map((s) => s.trim());
        for (let i = 1; i < parts.length; i++) {
          const cls = getClass(parts[i]!, innermost(block.path)?.anchor ?? "");
          cls.parent = parts[i - 1]!;
        }
      }
      continue;
    }

    if (block.kind === "list") {
      // Lists of option names on pages with a placeholder owner become fields of the owner table.
      if (placeholderTables.size > 0 && block.path.some((h) => /^overview$/i.test(h.text))) {
        const items = block.items.map((i) => i.trim());
        if (items.length > 0 && items.every((i) => /^[A-Za-z_]\w*$/.test(i))) {
          for (const [table, className] of placeholderTables) {
            const cls = getClass(table, innermost(block.path)?.anchor ?? "");
            for (const item of items) {
              if (!cls.fields.some((f) => f.name === item)) cls.fields.push({ name: item, type: className, anchor: innermost(block.path)?.anchor ?? "" });
            }
            note("inferred-from-example", `${table}.{${items.join(", ")}} typed as ${className} from the option name list`, innermost(block.path)?.anchor);
          }
        }
      }
      continue;
    }

    if (block.kind === "code") {
      const parsed = parsedByBlock.get(block);
      if (!parsed) continue;
      const anchor = innermost(block.path)?.anchor ?? "";
      const headingText = innermost(block.path)?.text.trim() ?? "";
      const headingName = headingText.includes(".") ? headingText.split(".").pop()! : headingText;
      const seenInBlock = new Map<string, FunctionSig>();
      for (const item of parsed) {
        if (item.kind === "index") {
          const owner = normaliseOwner(item.owner, block.path, anchor);
          const cls = getClass(owner, anchor);
          cls.index = { keyType: item.keyType, valueType: item.valueOptional ? `${item.valueType}?` : item.valueType, anchor };
          continue;
        }
        const sig = item.sig;
        if (sig.owner === "") {
          // Several signatures for one free function (lerp for number, Vector2, ...)
          // become one definition with overloads, as they already do for methods.
          const existingFree = freeFunctions.find((f) => f.name === sig.name);
          if (existingFree) {
            existingFree.overloads.push({ params: sig.params, returns: sig.returns });
            continue;
          }
          freeFunctions.push(sig);
          lastSigByHeading.set(anchor, sig);
          continue;
        }
        sig.owner = normaliseOwner(sig.owner, block.path, anchor);
        const cls = getClass(sig.owner, anchor);
        const key = `${sig.sep}${sig.name}`;
        const existingInBlock = seenInBlock.get(key);
        if (existingInBlock) {
          existingInBlock.overloads.push({ params: sig.params, returns: sig.returns });
          continue;
        }
        const duplicate = cls.methods.find((m) => m.name === sig.name && m.sep === sig.sep);
        if (duplicate) {
          if (/^\w+$/.test(headingName) && headingName !== sig.name) {
            note("name-from-heading", `${sig.owner}${sig.sep}${sig.name} appears twice; the second is renamed to heading "${headingName}"`, anchor);
            sig.name = headingName;
          } else {
            duplicate.overloads.push({ params: sig.params, returns: sig.returns });
            continue;
          }
        } else if (/^\w+$/.test(headingName) && !isSectionWord(headingName) && headingName !== sig.name && !/constructor/i.test(headingName)) {
          note("name-from-heading", `heading "${headingText}" documents ${sig.owner}${sig.sep}${sig.name}; signature name kept`, anchor);
        }
        seenInBlock.set(key, sig);
        cls.methods.push(sig);
        lastSigByHeading.set(anchor, sig);
      }
      continue;
    }

    // Tables
    const table: TableBlock = block;
    const header = table.header.map((h) => h.trim());
    const anchor = innermost(table.path)?.anchor ?? "";
    const sigHere = lastSigByHeading.get(anchor);
    const h0 = (header[0] ?? "").toLowerCase();
    const h1c = (header[1] ?? "").toLowerCase();

    if (h0 === "payload variable") {
      if (currentEvent) currentEvent.payload.push(...fieldsFromRows(table, anchor, options.id, notes));
      continue;
    }
    if (h0 === "name" && h1c === "parameters") {
      for (const row of table.rows) {
        const name = (row[0] ?? "").trim().split(/\s+/)[0] ?? "";
        if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) continue;
        const params = (row[1] ?? "").split("\n").map((p) => p.trim()).filter(Boolean).map(parseParam);
        let hook = hooks.find((h) => h.name === name);
        if (!hook) {
          hook = { name, variants: [], anchor };
          hooks.push(hook);
        }
        const rendered = JSON.stringify(params);
        if (!hook.variants.some((v) => JSON.stringify(v) === rendered)) hook.variants.push(params);
      }
      continue;
    }
    if (h0 === "domain") {
      for (const row of table.rows) {
        const name = (row[0] ?? "").trim();
        if (/^[A-Z]\w*$/.test(name)) scan.varDomains.push(name);
      }
      continue;
    }
    if ((h0 === "parameter" || h0 === "name") && h1c === "type" && sigHere) {
      // Parameter table: fill in types the signature left untyped.
      const typed = new Map<string, Param>();
      for (const row of table.rows) typed.set(sanitise(row[0] ?? ""), parseParam(`${row[0] ?? ""} : ${row[1] ?? "any"}`));
      for (const list of [sigHere.params, ...sigHere.overloads.map((o) => o.params)]) {
        for (const p of list) {
          const t = typed.get(p.name);
          if (p.type === "any" && t && t.type !== "any") {
            p.type = t.type;
            p.optional = p.optional || t.optional;
          }
        }
      }
      continue;
    }
    if (h0.startsWith("returns") || h0 === "getter returns") {
      if (!sigHere) continue;
      const cell = (table.rows[0]?.[0] ?? "").trim();
      if (!cell) continue;
      const converted = convertReturns(cell);
      if (converted.malformed) continue;
      if (sigHere.returns.length === 0) sigHere.returns = converted.types;
      else if (converted.types.join(", ") !== sigHere.returns.join(", ")) sigHere.tableReturns = converted.types;
      continue;
    }
    if (h0 === "key" && h1c === "type" && sigHere) {
      const ownerLast = sigHere.owner.split(".").pop() ?? "";
      const className = `${ownerLast}${sigHere.name}Table`;
      const cls = getClass(className, anchor);
      cls.fields.push(...fieldsFromRows(table, anchor, options.id, notes));
      for (const p of sigHere.params) if (p.type === "table") p.type = className;
      continue;
    }
    if (h0 === "name" && h1c === "value") {
      const heading = innermost(table.path);
      const name = heading ? stripSectionSuffix(heading.text) : "";
      if (!looksLikeIdentifierPath(name)) {
        note("unparsed-signature", `enumeration table under heading "${heading?.text ?? ""}" has no identifier name`, anchor);
        continue;
      }
      enums.push({
        name,
        anchor,
        members: table.rows
          .filter((r) => /^[A-Za-z_]\w*$/.test((r[0] ?? "").trim()))
          .map((r) => {
            const value = Number((r[1] ?? "").trim());
            return Number.isInteger(value) ? { name: r[0]!.trim(), value } : { name: r[0]!.trim() };
          }),
      });
      continue;
    }
    if (h0 === "value" && h1c === "description" && !sigHere) {
      const heading = innermost(table.path);
      const name = heading ? stripSectionSuffix(heading.text) : "";
      if (!looksLikeIdentifierPath(name)) {
        note("unparsed-signature", `enumeration table under heading "${heading?.text ?? ""}" has no identifier name`, anchor);
        continue;
      }
      enums.push({
        name,
        anchor,
        members: table.rows.filter((r) => /^[A-Za-z_]\w*$/.test((r[0] ?? "").trim())).map((r) => ({ name: r[0]!.trim() })),
      });
      continue;
    }
    if ((h0 === "name" || h0 === "property") && h1c === "type") {
      const className = propertyClassFor(table.path);
      if (!className) {
        note("unparsed-signature", `property table under "${innermost(table.path)?.text ?? ""}" has no owning class`, anchor);
        continue;
      }
      const cls = getClass(className, anchor);
      for (const field of fieldsFromRows(table, anchor, options.id, notes)) {
        if (!cls.fields.some((f) => f.name === field.name)) cls.fields.push(field);
      }
      continue;
    }
  }

  // The page class is documented by the whole page: point its link at the page itself.
  if (pageClass) {
    const cls = classes.get(pageClass);
    if (cls) cls.anchor = "";
  }

  const module: ModuleDef = {
    id: options.id,
    title: page.title || h1Text,
    url: options.url,
    classes: classOrder.map((n) => classes.get(n)!),
    freeFunctions,
    enums,
    events,
    hooks,
    notes,
  };
  return { module, scan };
}

function sanitise(name: string): string {
  return parseParam(`${name} : any`).name;
}

function fieldsFromRows(table: TableBlock, anchor: string, page: string, notes: Note[]): Field[] {
  const fields: Field[] = [];
  for (const row of table.rows) {
    // A cell holding several names (one per line) describes several fields of the same type.
    const names = (row[0] ?? "").split("\n").map((n) => n.trim()).filter((n) => /^[A-Za-z_]\w*$/.test(n));
    if (names.length === 0) continue;
    const typeText = (row[1] ?? "").trim();
    const converted = convertType(typeText.replace(/\n/g, "/"));
    if (converted.malformed) {
      notes.push({ kind: "malformed-type-cell", page, anchor, detail: `${names.join("/")}: type cell reads "${typeText}"; emitted as any` });
    }
    for (const name of names) fields.push({ name, type: converted.optional ? `${converted.type}?` : converted.type, anchor });
  }
  return fields;
}
