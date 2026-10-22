// Lifecycle checks: the contract every rule and skill states but preflight did
// not verify. A reload (prl) disables and re-enables the plugin, so anything
// not released in PluginShutdown leaks: a subscription fires twice, a window
// is drawn twice. These checks are token-based heuristics over the whole
// plugin, kept conservative so a correct plugin never pays for them.
//
//   shutdown-missing              error    subscriptions exist but no PluginShutdown is defined
//   subscribe-without-unsubscribe warning  Event.X.Subscribe(ref) with no Event.X.Unsubscribe(ref)
//                                          or component:Subscribe(ui.Hook.Y) with no matching Unsubscribe
//   component-not-destroyed       info     a top-level GroupBox, Layer or PagedLayer never passed to :Destroy()
//   per-tick-scan                 warning  a *List.All, *List.Find or GetAll call inside an Event.Logic or
//                                          Event.Draw handler with no counter guard (%) in the handler

import { DOCS, type Finding } from "./findings.js";
import type { LuaScan, LuaToken } from "./lua-scan.js";

export interface LifecycleFile {
  /** Path relative to the plugin folder. */
  rel: string;
  scan: LuaScan;
}

interface Subscription {
  key: string;
  display: string;
  file: string;
  line: number;
  /** For event subscriptions, the event name; for hooks, the receiver. */
  owner: string;
}

const CONTAINER_TYPES = new Set(["GroupBox", "Layer", "PagedLayer"]);
const OPENERS = new Set(["function", "do", "then", "repeat"]);

function isOp(t: LuaToken | undefined, value: string): boolean {
  return t?.kind === "op" && t.value === value;
}

/** Dotted or colon chain starting at a name token; returns the chain and the index after it. */
function chainFrom(tokens: LuaToken[], start: number): { chain: string; end: number } {
  let chain = tokens[start]!.value;
  let j = start + 1;
  while (tokens[j]?.kind === "op" && (tokens[j]!.value === "." || tokens[j]!.value === ":") && tokens[j + 1]?.kind === "name") {
    chain += tokens[j]!.value + tokens[j + 1]!.value;
    j += 2;
  }
  return { chain, end: j };
}

/** Argument ranges [start, end) of the call whose "(" is at open. */
function callArgs(tokens: LuaToken[], open: number): { start: number; end: number }[] {
  const args: { start: number; end: number }[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "op") continue;
    if (t.value === "(" || t.value === "{" || t.value === "[") depth++;
    else if (t.value === ")" || t.value === "}" || t.value === "]") {
      if (depth === 0) {
        if (i > start) args.push({ start, end: i });
        return args;
      }
      depth--;
    } else if (t.value === "," && depth === 0) {
      args.push({ start, end: i });
      start = i + 1;
    }
  }
  return args;
}

/** Stable text for an argument: string literals keep their quotes, names keep their chain. */
function argKey(tokens: LuaToken[], range: { start: number; end: number }): string {
  return tokens
    .slice(range.start, range.end)
    .map((t) => (t.kind === "string" ? `"${t.value}"` : t.value))
    .join("");
}

/** Index of the "end" that closes the block opened at index (a function, do, then or repeat token). */
function matchingEnd(tokens: LuaToken[], index: number): number {
  let depth = 0;
  for (let i = index; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "op") continue;
    if (OPENERS.has(t.value)) depth++;
    else if (t.value === "elseif")
      depth--; // its "then" re-opens the same block
    else if (t.value === "end" || t.value === "until") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

/** Block depth before each token, so top-level statements can be told from nested ones. */
function depths(tokens: LuaToken[]): number[] {
  const out: number[] = [];
  let depth = 0;
  for (const t of tokens) {
    out.push(depth);
    if (t.kind !== "op") continue;
    if (OPENERS.has(t.value)) depth++;
    else if (t.value === "elseif") depth--;
    else if (t.value === "end" || t.value === "until") depth = Math.max(0, depth - 1);
  }
  return out;
}

/** Body range of "function name(...)" or "local function name(...)" defined in the file. */
function functionBody(tokens: LuaToken[], name: string): { start: number; end: number } | undefined {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (isOp(tokens[i], "function") && tokens[i + 1]?.kind === "name" && tokens[i + 1]!.value === name && isOp(tokens[i + 2], "(")) {
      return { start: i, end: matchingEnd(tokens, i) };
    }
  }
  return undefined;
}

/** Run the lifecycle checks over every Lua file of a plugin. */
export function lifecycleFindings(files: LifecycleFile[]): Finding[] {
  const findings: Finding[] = [];
  const subscriptions: Subscription[] = [];
  const unsubscribed = new Set<string>();
  const unsubscribedAll = new Set<string>();
  let shutdownDefined = false;
  const destroyed = new Set<string>();
  const containers: { name: string; parent?: string; file: string; line: number; type: string }[] = [];
  const tickHandlers: { file: string; tokens: LuaToken[]; range: { start: number; end: number }; event: string; line: number }[] = [];

  for (const { rel, scan } of files) {
    const tokens = scan.tokens.filter((t) => t.kind !== "comment");
    const depth = depths(tokens);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.kind === "op" && t.value === "function" && tokens[i + 1]?.kind === "name" && tokens[i + 1]!.value === "PluginShutdown") {
        shutdownDefined = true;
        continue;
      }
      if (t.kind !== "name") continue;
      const prev = tokens[i - 1];
      if (prev && prev.kind === "op" && (prev.value === "." || prev.value === ":")) continue;
      const { chain, end } = chainFrom(tokens, i);
      const callOpen = isOp(tokens[end], "(") ? end : undefined;

      // Event.<Name>.Subscribe(ref, handler) and Event.<Name>.Unsubscribe(ref)
      const event = /^Event\.(\w+)\.(Subscribe|Unsubscribe)$/.exec(chain);
      if (event && callOpen !== undefined) {
        const args = callArgs(tokens, callOpen);
        const ref = args[0] ? argKey(tokens, args[0]) : "";
        const key = `event:${event[1]}:${ref}`;
        if (event[2] === "Subscribe") {
          subscriptions.push({ key, display: `Event.${event[1]}.Subscribe(${ref})`, file: rel, line: t.line, owner: event[1]! });
          if ((event[1] === "Logic" || event[1] === "Draw") && args[1]) {
            const handler = tokens[args[1].start]!;
            let range: { start: number; end: number } | undefined;
            if (isOp(handler, "function")) range = { start: args[1].start, end: matchingEnd(tokens, args[1].start) };
            else if (handler.kind === "name" && args[1].end === args[1].start + 1) range = functionBody(tokens, handler.value);
            if (range) tickHandlers.push({ file: rel, tokens, range, event: event[1]!, line: t.line });
          }
        } else {
          unsubscribed.add(key);
        }
        continue;
      }

      // component:Subscribe(ui.Hook.X, ...), component:Unsubscribe(ui.Hook.X[, id]), component:UnsubscribeAll()
      const hook = /^([A-Za-z_]\w*(?:\.\w+)*):(Subscribe|Unsubscribe|UnsubscribeAll)$/.exec(chain);
      if (hook && callOpen !== undefined) {
        const receiver = hook[1]!;
        if (hook[2] === "UnsubscribeAll") {
          unsubscribedAll.add(receiver);
          continue;
        }
        const args = callArgs(tokens, callOpen);
        const first = args[0] ? argKey(tokens, args[0]) : "";
        if (!first.startsWith("ui.Hook.")) continue;
        const key = `hook:${receiver}:${first}`;
        if (hook[2] === "Subscribe") subscriptions.push({ key, display: `${receiver}:Subscribe(${first})`, file: rel, line: t.line, owner: receiver });
        else unsubscribed.add(key);
        continue;
      }

      // name:Destroy()
      const destroy = /^([A-Za-z_]\w*):Destroy$/.exec(chain);
      if (destroy && callOpen !== undefined) {
        destroyed.add(destroy[1]!);
        continue;
      }

      // Top-level "local name = ui.<Container>.new(parent)"
      if (t.value === "local") continue;
      if (isOp(prev, "local") && depth[i] === 0 && isOp(tokens[i + 1], "=") && tokens[i + 2]?.kind === "name") {
        const ctor = chainFrom(tokens, i + 2);
        const m = /^ui\.(\w+)\.new$/.exec(ctor.chain);
        if (m && CONTAINER_TYPES.has(m[1]!) && isOp(tokens[ctor.end], "(")) {
          const args = callArgs(tokens, ctor.end);
          const parentToken = args[0] ? tokens[args[0].start] : undefined;
          const parent = parentToken?.kind === "name" && args[0]!.end === args[0]!.start + 1 ? parentToken.value : undefined;
          containers.push({ name: t.value, parent, file: rel, line: t.line, type: m[1]! });
        }
      }
    }
  }

  if (subscriptions.length > 0 && !shutdownDefined) {
    const first = subscriptions[0]!;
    findings.push({
      level: "error",
      code: "shutdown-missing",
      message: `${first.display} is never released: define function PluginShutdown() in main.lua and unsubscribe every event and hook there, or a reload (prl) runs the handler twice`,
      file: first.file,
      line: first.line,
      docsUrl: DOCS.events,
    });
  }

  for (const sub of subscriptions) {
    const released = unsubscribed.has(sub.key) || (sub.key.startsWith("hook:") && unsubscribedAll.has(sub.owner));
    if (released) continue;
    const isHook = sub.key.startsWith("hook:");
    findings.push({
      level: "warning",
      code: "subscribe-without-unsubscribe",
      message: isHook
        ? `${sub.display} has no matching ${sub.owner}:Unsubscribe(...) in PluginShutdown; the hook stays attached after a reload`
        : `${sub.display} has no matching Event.${sub.owner}.Unsubscribe(...) with the same reference; the handler leaks on reload`,
      file: sub.file,
      line: sub.line,
      docsUrl: isHook ? DOCS.componentUnsubscribe : DOCS.events,
    });
  }

  for (const c of containers) {
    if (destroyed.has(c.name)) continue;
    if (c.parent && destroyed.has(c.parent)) continue;
    findings.push({
      level: "info",
      code: "component-not-destroyed",
      message: `ui.${c.type} "${c.name}" is created at the top level but never passed to ${c.name}:Destroy(); destroy it in PluginShutdown so a reload does not draw it twice`,
      file: c.file,
      line: c.line,
      docsUrl: DOCS.componentDestroy,
    });
  }

  for (const h of tickHandlers) {
    const body = h.tokens.slice(h.range.start, h.range.end + 1);
    const guarded = body.some((t) => t.kind === "op" && t.value === "%");
    if (guarded) continue;
    for (let i = 0; i < body.length; i++) {
      const t = body[i]!;
      if (t.kind !== "name") continue;
      const prev = body[i - 1];
      if (prev && prev.kind === "op" && (prev.value === "." || prev.value === ":")) continue;
      const { chain, end } = chainFrom(body, i);
      if (!isOp(body[end], "(")) continue;
      if (/(?:^|\.)\w*List\.(?:All|Find)$/.test(chain) || /\.GetAll$/.test(chain)) {
        findings.push({
          level: "warning",
          code: "per-tick-scan",
          message: `${chain}(...) runs inside the Event.${h.event} handler on every ${h.event === "Draw" ? "frame" : "tick"}; cache the result and refresh it on a counter (for example every 50 ticks)`,
          file: h.file,
          line: t.line,
          docsUrl: DOCS.eventsLogic,
        });
        break;
      }
    }
  }

  return findings;
}
