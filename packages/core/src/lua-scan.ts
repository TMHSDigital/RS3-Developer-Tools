// A small Lua 5.4 lexer that is good enough for static checks: it separates
// comments and string literals from code so identifier searches do not match
// text inside strings or comments, and it collects a few readability metrics.
//
// It is deliberately not a full parser. Preflight needs to know which global
// names a file touches, what string literals it contains, and how much of it
// is commentary; nothing more.

export interface LuaToken {
  kind: "name" | "string" | "number" | "op" | "comment";
  value: string;
  line: number;
}

export interface LuaScan {
  tokens: LuaToken[];
  /** Lines that contain at least one code token. */
  codeLines: number;
  /** Lines that contain a comment (and possibly code). */
  commentLines: number;
  totalLines: number;
  longestLine: number;
  /** All string literal contents (escapes left as written). */
  strings: { value: string; line: number }[];
}

const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in",
  "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
]);

export function scanLua(source: string): LuaScan {
  const text = source.replace(/\r\n?/g, "\n");
  const tokens: LuaToken[] = [];
  const strings: { value: string; line: number }[] = [];
  const codeLineSet = new Set<number>();
  const commentLineSet = new Set<number>();
  let i = 0;
  let line = 1;
  const n = text.length;

  const longBracketLevel = (pos: number): number | undefined => {
    // Returns the level of a long bracket starting at pos ("[", "[=", "[==" ...) or undefined.
    if (text[pos] !== "[") return undefined;
    let j = pos + 1;
    let level = 0;
    while (text[j] === "=") {
      level++;
      j++;
    }
    return text[j] === "[" ? level : undefined;
  };
  const readLongBracket = (pos: number, level: number): { value: string; end: number } => {
    const open = pos + level + 2;
    const close = "]" + "=".repeat(level) + "]";
    const endIndex = text.indexOf(close, open);
    const end = endIndex === -1 ? n : endIndex + close.length;
    return { value: text.slice(open, endIndex === -1 ? n : endIndex), end };
  };
  const advanceLines = (fragment: string) => {
    for (const ch of fragment) if (ch === "\n") line++;
  };

  while (i < n) {
    const ch = text[i]!;
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    // Comments
    if (ch === "-" && text[i + 1] === "-") {
      const level = longBracketLevel(i + 2);
      if (level !== undefined) {
        const { value, end } = readLongBracket(i + 2, level);
        const raw = text.slice(i, end);
        tokens.push({ kind: "comment", value, line });
        for (let l = 0; l <= value.split("\n").length - 1; l++) commentLineSet.add(line + l);
        advanceLines(raw);
        i = end;
      } else {
        let end = text.indexOf("\n", i);
        if (end === -1) end = n;
        tokens.push({ kind: "comment", value: text.slice(i + 2, end), line });
        commentLineSet.add(line);
        i = end;
      }
      continue;
    }
    // Strings
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < n && text[j] !== ch) {
        if (text[j] === "\\") {
          value += text[j]! + (text[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (text[j] === "\n") break;
        value += text[j]!;
        j++;
      }
      tokens.push({ kind: "string", value, line });
      strings.push({ value, line });
      codeLineSet.add(line);
      i = j + 1;
      continue;
    }
    const level = longBracketLevel(i);
    if (level !== undefined) {
      const { value, end } = readLongBracket(i, level);
      tokens.push({ kind: "string", value, line });
      strings.push({ value, line });
      codeLineSet.add(line);
      advanceLines(text.slice(i, end));
      i = end;
      continue;
    }
    // Numbers
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      const m = /^(0[xX][0-9a-fA-F.]+(?:[pP][+-]?\d+)?|\d*\.?\d+(?:[eE][+-]?\d+)?|\d+\.?)/.exec(text.slice(i));
      const value = m ? m[0] : ch;
      tokens.push({ kind: "number", value, line });
      codeLineSet.add(line);
      i += value.length;
      continue;
    }
    // Names and keywords
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      const value = text.slice(i, j);
      tokens.push({ kind: KEYWORDS.has(value) ? "op" : "name", value, line });
      codeLineSet.add(line);
      i = j;
      continue;
    }
    // Operators and punctuation
    const three = text.slice(i, i + 3);
    const two = text.slice(i, i + 2);
    const op = three === "..." ? three : ["==", "~=", "<=", ">=", "//", "::", "<<", ">>", ".."].includes(two) ? two : ch;
    tokens.push({ kind: "op", value: op, line });
    codeLineSet.add(line);
    i += op.length;
  }

  const lines = text.split("\n");
  return {
    tokens,
    codeLines: codeLineSet.size,
    commentLines: commentLineSet.size,
    totalLines: lines.length,
    longestLine: lines.reduce((max, l) => Math.max(max, l.length), 0),
    strings,
  };
}

/**
 * Names that are read as globals: a name token not preceded by "." or ":" and not
 * declared with "local" or as a function parameter in the file. The declaration
 * tracking is approximate (file-wide, no scoping), which is fine for spotting
 * use of sandbox-forbidden libraries.
 */
export function globalReads(scan: LuaScan): { name: string; line: number }[] {
  const declared = new Set<string>();
  const tokens = scan.tokens.filter((t) => t.kind !== "comment");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "op" && t.value === "local") {
      let j = i + 1;
      if (tokens[j]?.value === "function") j++;
      while (tokens[j]?.kind === "name") {
        declared.add(tokens[j]!.value);
        j++;
        if (tokens[j]?.value !== ",") break;
        j++;
      }
    }
    if (t.kind === "op" && t.value === "function") {
      // function name(a, b) or function(a, b)
      let j = i + 1;
      while (tokens[j] && tokens[j]!.value !== "(") j++;
      j++;
      while (tokens[j] && tokens[j]!.value !== ")") {
        if (tokens[j]!.kind === "name") declared.add(tokens[j]!.value);
        j++;
      }
    }
    if (t.kind === "op" && t.value === "for") {
      let j = i + 1;
      while (tokens[j]?.kind === "name") {
        declared.add(tokens[j]!.value);
        j++;
        if (tokens[j]?.value !== ",") break;
        j++;
      }
    }
  }
  const reads: { name: string; line: number }[] = [];
  // Innermost open bracket, so "{ debug = false }" is recognised as a table
  // constructor key and "f(a, b)" is not.
  const brackets: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "op") {
      if (t.value === "{" || t.value === "(" || t.value === "[") brackets.push(t.value);
      else if (t.value === "}" || t.value === ")" || t.value === "]") brackets.pop();
      continue;
    }
    if (t.kind !== "name") continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev && prev.kind === "op") {
      // Field access: obj.debug, obj:load().
      if (prev.value === "." || prev.value === ":") continue;
      // goto labels: "goto debug" and "::debug::" name a jump target, not a value.
      if (prev.value === "goto" || (prev.value === "::" && next?.kind === "op" && next.value === "::")) continue;
      // Table constructor key: "{ debug = false }" or "{ a = 1, io = 2 }". The
      // name is a string key, not a read of the global.
      const inConstructor = brackets[brackets.length - 1] === "{";
      const afterSeparator = prev.value === "{" || prev.value === "," || prev.value === ";";
      if (inConstructor && afterSeparator && next?.kind === "op" && next.value === "=") continue;
    }
    if (declared.has(t.value)) continue;
    reads.push({ name: t.value, line: t.line });
  }
  return reads;
}

/**
 * Globals reached through the environment table rather than by name:
 * "_G.os", "_G["io"]" and "rawget(_G, "debug")". These are the shapes a
 * plugin would use to get around a name-based check, so preflight reports
 * them exactly like the direct read.
 */
export function indirectGlobalReads(scan: LuaScan): { name: string; line: number }[] {
  const tokens = scan.tokens.filter((t) => t.kind !== "comment");
  const reads: { name: string; line: number }[] = [];
  const isOp = (t: LuaToken | undefined, value: string) => t?.kind === "op" && t.value === value;
  const isName = (t: LuaToken | undefined, value: string) => t?.kind === "name" && t.value === value;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isName(t, "_G")) {
      const a = tokens[i + 1];
      const b = tokens[i + 2];
      if (isOp(a, ".") && b?.kind === "name") reads.push({ name: b.value, line: b.line });
      else if (isOp(a, "[") && b?.kind === "string" && isOp(tokens[i + 3], "]")) reads.push({ name: b.value, line: b.line });
      continue;
    }
    if (isName(t, "rawget") && isOp(tokens[i + 1], "(") && isName(tokens[i + 2], "_G") && isOp(tokens[i + 3], ",")) {
      const key = tokens[i + 4];
      if (key?.kind === "string") reads.push({ name: key.value, line: key.line });
    }
  }
  return reads;
}

/**
 * require("x/y") calls found from tokens, so comments and strings that merely
 * mention require do not count. Both require("x") and require "x" are matched.
 */
export function requireCalls(scan: LuaScan): { target: string; line: number }[] {
  const tokens = scan.tokens.filter((t) => t.kind !== "comment");
  const calls: { target: string; line: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "name" || t.value !== "require") continue;
    const prev = tokens[i - 1];
    if (prev && prev.kind === "op" && (prev.value === "." || prev.value === ":")) continue;
    let j = i + 1;
    if (tokens[j]?.kind === "op" && tokens[j]!.value === "(") j++;
    const arg = tokens[j];
    if (arg?.kind === "string") calls.push({ target: arg.value, line: arg.line });
  }
  return calls;
}

/** Dotted access chains such as "Event.ChatMessage.Subscribe" or "Chat.AddMessage". */
export function memberChains(scan: LuaScan): { chain: string; line: number }[] {
  const tokens = scan.tokens.filter((t) => t.kind !== "comment");
  const chains: { chain: string; line: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "name") continue;
    const prev = tokens[i - 1];
    if (prev && prev.kind === "op" && (prev.value === "." || prev.value === ":")) continue;
    let chain = t.value;
    let j = i + 1;
    while (tokens[j] && tokens[j]!.kind === "op" && (tokens[j]!.value === "." || tokens[j]!.value === ":") && tokens[j + 1]?.kind === "name") {
      chain += tokens[j]!.value + tokens[j + 1]!.value;
      j += 2;
    }
    if (chain.includes(".") || chain.includes(":")) chains.push({ chain, line: t.line });
  }
  return chains;
}
