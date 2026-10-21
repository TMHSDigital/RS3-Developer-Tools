// Orchestrates a full generation run: crawl the navigation, parse every API
// page, resolve type references across pages, apply the documented overrides,
// and render the output files plus the lookup index and the unresolved report.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DocsClient, extractNavLinks } from "@tmhs/rs3-devtools-core";
import { parsePage } from "./parse.js";
import { buildPageModel, type PageScan } from "./model.js";
import { collectReferences, dedupe } from "./lua-types.js";
import {
  emitExtras,
  emitGlobals,
  emitModule,
  emitNamespaces,
  emitUnresolved,
  indexEntries,
  moduleFilePath,
} from "./emit.js";
import type { FunctionSig, GenerateResult, GlobalTables, IndexEntry, ModuleDef, Note, Param } from "./types.js";

/** Documentation sections that document API modules (everything else is tutorial or policy). */
export const API_SECTIONS = ["core/", "game/", "math/", "ui/", "audio/"];

export interface Overrides {
  classParents: { class: string; parent: string; see: string; reason: string }[];
  eventCallbackReturnsBoolean: { event: string; see: string; reason: string }[];
  extraFields: { class: string; name: string; type: string; see: string; reason: string }[];
  ownerPlaceholders: { owner: string; class: string; table: string; see: string; reason: string }[];
  returnTypes: { function: string; type: string; see: string; reason: string }[];
  globalFunctions: { name: string; params: { name: string; type: string }[]; see: string; reason: string }[];
  aliases: { name: string; type: string; see: string; reason: string }[];
}

export function loadOverrides(): Overrides {
  const file = fileURLToPath(new URL("../overrides.json", import.meta.url));
  return JSON.parse(readFileSync(file, "utf8")) as Overrides;
}

export interface GenerateOptions {
  client: DocsClient;
  /** Optional explicit page list (relative paths); defaults to the nav of index.html. */
  pages?: string[];
  overrides?: Overrides;
  log?: (message: string) => void;
}

function isApiPage(relPath: string): boolean {
  return API_SECTIONS.some((prefix) => relPath.startsWith(prefix));
}

function pageOf(see: string): string {
  return see.split("#")[0]!.replace(/\.html$/, "");
}

/** Rewrite type names inside a LuaLS type expression, leaving parameter names alone. */
function rewriteType(type: string, map: Map<string, string>): string {
  return type.replace(/([A-Za-z_][A-Za-z0-9_.]*)(\s*\??\s*:)?/g, (whole, name: string, colon?: string) => {
    if (colon) return whole;
    const mapped = map.get(name);
    return mapped ? whole.replace(name, mapped) : whole;
  });
}

function qualifiedName(sig: FunctionSig): string {
  return sig.owner ? `${sig.owner}${sig.sep}${sig.name}` : sig.name;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { client } = options;
  const overrides = options.overrides ?? loadOverrides();
  const log = options.log ?? (() => undefined);
  const notes: Note[] = [];

  const index = await client.getPage("index.html");
  const pages = (options.pages ?? extractNavLinks(index.html)).slice().sort();
  log(`crawling ${pages.length} pages`);

  const modules: ModuleDef[] = [];
  const scans: PageScan[] = [];
  for (const relPath of pages) {
    const page = await client.getPage(relPath);
    const parsed = parsePage(page.html);
    const id = relPath.replace(/\.html$/, "");
    const { module, scan } = buildPageModel(parsed, {
      id,
      url: page.url,
      ownerPlaceholders: overrides.ownerPlaceholders.map((p) => ({ owner: p.owner, class: p.class, table: p.table })),
    });
    scans.push(scan);
    if (isApiPage(relPath)) modules.push(module);
  }
  modules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const allSigs: { sig: FunctionSig; module: ModuleDef }[] = [];
  for (const mod of modules) {
    for (const cls of mod.classes) for (const m of cls.methods) allSigs.push({ sig: m, module: mod });
    for (const fn of mod.freeFunctions) allSigs.push({ sig: fn, module: mod });
  }

  // Overrides: parents, event return flags, extra fields, return types.
  const findClass = (name: string) => {
    for (const mod of modules) {
      const cls = mod.classes.find((c) => c.name === name);
      if (cls) return { mod, cls };
    }
    return undefined;
  };
  for (const o of overrides.classParents) {
    const found = findClass(o.class);
    if (!found) continue;
    found.cls.parent = o.parent;
    notes.push({ kind: "override-applied", page: pageOf(o.see), detail: `${o.class} : ${o.parent}. ${o.reason}` });
  }
  for (const o of overrides.eventCallbackReturnsBoolean) {
    for (const mod of modules) {
      const ev = mod.events.find((e) => e.name === o.event);
      if (ev) {
        ev.returnsBoolean = true;
        notes.push({ kind: "override-applied", page: mod.id, anchor: ev.anchor, detail: `Event.${o.event} callback returns boolean. ${o.reason}` });
      }
    }
  }
  for (const o of overrides.extraFields) {
    const found = findClass(o.class);
    if (!found) continue;
    if (!found.cls.fields.some((f) => f.name === o.name)) {
      found.cls.fields.push({ name: o.name, type: o.type, anchor: o.see.split("#")[1] ?? "" });
      notes.push({ kind: "override-applied", page: found.mod.id, anchor: o.see.split("#")[1], detail: `${o.class}.${o.name}: ${o.type}. ${o.reason}` });
    }
  }
  for (const o of overrides.returnTypes) {
    const entry = allSigs.find((s) => qualifiedName(s.sig) === o.function);
    if (!entry) continue;
    entry.sig.returns = [o.type];
    entry.sig.tableReturns = undefined;
    notes.push({ kind: "override-applied", page: entry.module.id, anchor: entry.sig.anchor, detail: `${o.function} returns ${o.type}. ${o.reason}` });
  }
  for (const o of overrides.ownerPlaceholders) {
    notes.push({ kind: "override-applied", page: pageOf(o.see), detail: `owner "${o.owner}" is class ${o.class} stored in ${o.table}. ${o.reason}` });
  }

  // Globals used as tables anywhere in the docs' code samples.
  const usedTables = new Set(scans.flatMap((s) => s.usedTables));
  for (const mod of modules) {
    for (const cls of mod.classes) {
      const hasStatic = cls.methods.some((m) => m.sep === ".");
      cls.isGlobal = hasStatic || usedTables.has(cls.name) || (cls.fields.length > 0 && cls.methods.length === 0 && cls.name.includes("."));
    }
  }

  // Lookup tables: config.<X>, id.<X>, var.<Domain>.
  const configClasses = new Set<string>();
  for (const mod of modules) {
    if (!mod.id.startsWith("game/config/")) continue;
    for (const cls of mod.classes) if (cls.name.endsWith("Type")) configClasses.add(cls.name);
  }
  const configNames = dedupe([
    ...[...configClasses].map((c) => c.slice(0, -"Type".length)),
    ...scans.flatMap((s) => s.configTables),
  ]).sort();
  const globals: GlobalTables = { config: {}, id: [], var: [] };
  for (const name of configNames) {
    const cls = `${name}Type`;
    if (configClasses.has(cls)) {
      globals.config[name] = cls;
    } else {
      globals.config[name] = "any";
      notes.push({ kind: "unresolved-type", page: "game/index", detail: `config.${name} is used in docs code but no ${cls} page exists; value type emitted as any` });
    }
  }
  globals.id = dedupe([...configNames, ...scans.flatMap((s) => s.idTables)]).sort();
  globals.var = dedupe([...scans.flatMap((s) => s.varDomains), ...scans.flatMap((s) => s.varTables)]).sort();
  notes.push({
    kind: "inferred-from-example",
    page: "game/config/npctype",
    anchor: "overview",
    detail: "config.<Name>, id.<Name> and var.<Domain> tables and their FromID(integer) functions are read from the code samples on the config pages; no page declares them as signatures",
  });

  // Type resolution across modules.
  const known = new Set<string>();
  for (const mod of modules) {
    for (const cls of mod.classes) known.add(cls.name);
    for (const e of mod.enums) known.add(e.name);
    for (const ev of mod.events) {
      known.add(`Event.${ev.name}`);
      if (ev.payload.length > 0) known.add(`${ev.name}Event`);
    }
    if (mod.hooks.length > 0) known.add("ui.Hook");
  }
  known.add("Event");
  for (const name of Object.keys(globals.config)) known.add(`config.${name}`);
  for (const name of globals.id) known.add(`id.${name}`);
  for (const name of globals.var) known.add(`var.${name}`);
  known.add("config").add("id").add("var");
  for (const alias of overrides.aliases) known.add(alias.name);

  const namespaces = new Set<string>();
  for (const name of known) {
    const first = name.split(".")[0]!;
    if (name.includes(".") && !known.has(first) && !["Event", "config", "id", "var"].includes(first)) namespaces.add(first);
  }

  const resolution = new Map<string, string>();
  const unresolved = new Map<string, Set<string>>();
  const resolve = (ref: string, where: string): void => {
    if (known.has(ref) || resolution.has(ref)) return;
    for (const candidate of [`ui.${ref}`, `audio.${ref}`, `${ref}Type`]) {
      if (known.has(candidate)) {
        resolution.set(ref, candidate);
        if (candidate.endsWith("Type")) {
          notes.push({ kind: "unresolved-type", page: where.split("#")[0]!, anchor: where.split("#")[1], detail: `${ref} is not declared on any page; resolved to the config type ${candidate}` });
        }
        return;
      }
    }
    const set = unresolved.get(ref) ?? new Set<string>();
    set.add(where);
    unresolved.set(ref, set);
  };
  const visitType = (type: string, where: string) => {
    for (const ref of collectReferences(type)) resolve(ref, where);
  };
  const isKnownType = (type: string) => collectReferences(type).every((ref) => known.has(ref) || resolution.has(ref));

  for (const mod of modules) {
    const where = (anchor: string) => `${mod.id}${anchor ? "#" + anchor : ""}`;
    for (const cls of mod.classes) {
      if (cls.parent) resolve(cls.parent, where(cls.anchor));
      for (const f of cls.fields) visitType(f.type, where(f.anchor));
      if (cls.index) {
        visitType(cls.index.keyType, where(cls.index.anchor));
        visitType(cls.index.valueType, where(cls.index.anchor));
      }
    }
    for (const ev of mod.events) for (const f of ev.payload) visitType(f.type, where(ev.anchor));
    for (const hook of mod.hooks) for (const v of hook.variants) for (const p of v) visitType(p.type, where(hook.anchor));
  }
  for (const { sig, module } of allSigs) {
    const where = `${module.id}${sig.anchor ? "#" + sig.anchor : ""}`;
    for (const p of sig.params) visitType(p.type, where);
    for (const o of sig.overloads) {
      for (const p of o.params) visitType(p.type, where);
      for (const r of o.returns) visitType(r, where);
    }
    // Return types: prefer the signature line; fall back to the returns table when the
    // signature names a type no page declares and the table names one that is declared.
    if (sig.tableReturns) {
      const sigKnown = sig.returns.every(isKnownType);
      const tableKnown = sig.tableReturns.every(isKnownType);
      if (!sigKnown && tableKnown) {
        notes.push({ kind: "return-mismatch", page: module.id, anchor: sig.anchor, detail: `${qualifiedName(sig)}: signature says "${sig.returns.join(", ")}", returns table says "${sig.tableReturns.join(", ")}"; the table type is used because the signature type is not declared anywhere` });
        sig.returns = sig.tableReturns;
      } else {
        notes.push({ kind: "return-mismatch", page: module.id, anchor: sig.anchor, detail: `${qualifiedName(sig)}: signature says "${sig.returns.join(", ")}", returns table says "${sig.tableReturns.join(", ")}"; the signature type is used` });
      }
      sig.tableReturns = undefined;
    }
    for (const r of sig.returns) visitType(r, where);
  }
  for (const o of overrides.extraFields) visitType(o.type, o.see);
  for (const o of overrides.globalFunctions) for (const p of o.params) visitType(p.type, o.see);

  // Apply the resolution map everywhere.
  const fix = (type: string) => rewriteType(type, resolution);
  const fixParams = (params: Param[]) => params.forEach((p) => (p.type = fix(p.type)));
  for (const mod of modules) {
    for (const cls of mod.classes) {
      if (cls.parent) cls.parent = resolution.get(cls.parent) ?? cls.parent;
      for (const f of cls.fields) f.type = fix(f.type);
      if (cls.index) {
        cls.index.keyType = fix(cls.index.keyType);
        cls.index.valueType = fix(cls.index.valueType);
      }
    }
    for (const ev of mod.events) for (const f of ev.payload) f.type = fix(f.type);
    for (const hook of mod.hooks) for (const v of hook.variants) fixParams(v);
  }
  for (const { sig } of allSigs) {
    fixParams(sig.params);
    sig.returns = sig.returns.map(fix);
    for (const o of sig.overloads) {
      fixParams(o.params);
      o.returns = o.returns.map(fix);
    }
  }
  for (const [name, refs] of [...unresolved.entries()].sort()) {
    const sorted = [...refs].sort();
    notes.push({ kind: "unresolved-type", page: sorted[0]!.split("#")[0]!, detail: `${name} is referenced by ${sorted.join(", ")} but no page declares it; aliased to any` });
  }

  // Render.
  const files: Record<string, string> = {};
  const indexEntriesAll: IndexEntry[] = [];
  for (const mod of modules) {
    const emitted = emitModule(mod);
    if (!emitted) continue;
    files[emitted.path] = emitted.content;
    indexEntriesAll.push(...indexEntries(mod, moduleFilePath(mod.id)));
  }
  const emitOptions = {
    baseUrl: client.baseUrl,
    unresolved: [...unresolved.entries()].sort().map(([name, refs]) => ({ name, references: [...refs].sort() })),
    aliases: overrides.aliases.map((a) => ({ name: a.name, type: a.type, see: a.see })),
    globalFunctions: overrides.globalFunctions.map((g) => ({
      name: g.name,
      see: g.see,
      params: g.params.map((p) => ({ name: p.name, type: fix(p.type), optional: false, vararg: false })),
    })),
    globals,
    namespaces: [...namespaces].sort(),
  };
  for (const o of overrides.aliases) notes.push({ kind: "override-applied", page: pageOf(o.see), detail: `alias ${o.name} = ${o.type}. ${o.reason}` });
  for (const o of overrides.globalFunctions) notes.push({ kind: "override-applied", page: pageOf(o.see), detail: `global function ${o.name}. ${o.reason}` });

  for (const file of [emitNamespaces(emitOptions.namespaces, client.baseUrl), emitGlobals(globals, client.baseUrl), emitExtras(emitOptions), emitUnresolved(emitOptions)]) {
    files[file.path] = file.content;
  }
  const globalsPath = "stubs/_globals.lua";
  for (const name of Object.keys(globals.config)) {
    indexEntriesAll.push({ name: `config.${name}`, kind: "global-table", module: "_globals", file: globalsPath, url: `${client.baseUrl}game/config/${name.toLowerCase()}type.html`, signature: `config.${name}: { [string]: ${globals.config[name]} }` });
  }
  for (const name of globals.id) {
    indexEntriesAll.push({ name: `id.${name}`, kind: "global-table", module: "_globals", file: globalsPath, url: `${client.baseUrl}game/config/npctype.html#examples`, signature: `id.${name}: { [string]: integer }` });
  }
  for (const name of globals.var) {
    indexEntriesAll.push({ name: `var.${name}`, kind: "global-table", module: "_globals", file: globalsPath, url: `${client.baseUrl}game/config/vartype.html#overview`, signature: `var.${name}: { [string]: VarType }` });
  }

  const allNotes = dedupeNotes([...modules.flatMap((m) => m.notes), ...notes]).sort(compareNotes);
  indexEntriesAll.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  files["index.json"] =
    JSON.stringify(
      {
        baseUrl: client.baseUrl,
        modules: modules.map((m) => ({ id: m.id, title: m.title, url: m.url, file: moduleFilePath(m.id) })),
        symbols: indexEntriesAll,
      },
      null,
      2,
    ) + "\n";
  files["unresolved.md"] = renderNotes(allNotes, client.baseUrl);

  return { modules, files, index: indexEntriesAll, notes: allNotes };
}

function noteKey(n: Note): string {
  return `${n.kind}|${n.page}|${n.anchor ?? ""}|${n.detail}`;
}

function dedupeNotes(notes: Note[]): Note[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = noteKey(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareNotes(a: Note, b: Note): number {
  const ka = noteKey(a);
  const kb = noteKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

const NOTE_TITLES: Record<Note["kind"], string> = {
  "unparsed-signature": "Signatures that could not be parsed",
  "unresolved-type": "Types referenced but never declared",
  "owner-normalised": "Signature owners normalised to the page class",
  "name-from-heading": "Member names that differ between heading and signature",
  "return-mismatch": "Return types that differ between signature and table",
  "malformed-type-cell": "Property rows whose type cell is prose (emitted as any)",
  "member-without-signature": "Members documented by heading only",
  "override-applied": "Overrides applied (see overrides.json)",
  "inferred-from-example": "Shapes inferred from documented lists and code samples",
};

function renderNotes(notes: Note[], baseUrl: string): string {
  const lines: string[] = [
    "# Unresolved and inferred API surface",
    "",
    "Generated by @tmhs/rs3-stubs-generator. Everything listed here was not stated as a plain signature in the documentation and is either reported without a stub, emitted with a conservative type, or taken from an explicitly documented override. Links go to the exact documentation page.",
    "",
  ];
  for (const kind of Object.keys(NOTE_TITLES) as Note["kind"][]) {
    const items = notes.filter((n) => n.kind === kind);
    if (items.length === 0) continue;
    lines.push(`## ${NOTE_TITLES[kind]}`, "");
    for (const n of items) {
      const url = `${baseUrl}${n.page}.html${n.anchor ? "#" + n.anchor : ""}`;
      lines.push(`- ${n.detail} ([${n.page}](${url}))`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
