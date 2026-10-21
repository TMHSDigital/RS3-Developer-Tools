// Turns one documentation page into a flat, ordered list of blocks.
//
// Every block carries the stack of headings it sits under, which is all the
// model builder needs. Admonitions ("Example", "Info", "Warning") and
// collapsible details blocks are flattened; the admonition kind is recorded so
// example code is never mistaken for a signature.

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export interface Heading {
  level: number;
  text: string;
  anchor: string;
}

export interface HeadingBlock {
  kind: "heading";
  heading: Heading;
  path: Heading[];
}

export interface CodeBlock {
  kind: "code";
  language: string;
  lines: string[];
  admonition: string | null;
  path: Heading[];
}

export interface TableBlock {
  kind: "table";
  header: string[];
  /** Rows of cells; each cell keeps line breaks (from <br>) as "\n". */
  rows: string[][];
  admonition: string | null;
  path: Heading[];
}

export interface ParagraphBlock {
  kind: "para";
  text: string;
  admonition: string | null;
  path: Heading[];
}

export interface ListBlock {
  kind: "list";
  items: string[];
  admonition: string | null;
  path: Heading[];
}

export type Block = HeadingBlock | CodeBlock | TableBlock | ParagraphBlock | ListBlock;

export interface ParsedPage {
  title: string;
  blocks: Block[];
}

const BR = "\u0001";

function textWithBreaks($: cheerio.CheerioAPI, el: AnyNode): string {
  const clone = $(el).clone();
  clone.find("br").replaceWith(BR);
  return clone
    .text()
    .split(BR)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
    .join("\n");
}

function admonitionKind(classes: string): string {
  const skip = new Set(["admonition", "details", "annotate", "inline", "end", "left", "right"]);
  const names = classes.split(/\s+/).filter((c) => c && !skip.has(c));
  return names[0] ?? "admonition";
}

/** Parse a docs page's main article into blocks. */
export function parsePage(html: string): ParsedPage {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s*-\s*RuneScape Client API\s*$/i, "").trim();
  const main = $(".md-content__inner").first();
  const blocks: Block[] = [];
  const stack: Heading[] = [];

  const walk = (el: AnyNode, admonition: string | null): void => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (!tag) return;
    const $el = $(el);

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const heading: Heading = {
        level,
        text: $el.text().replace(/¶/g, "").replace(/\s+/g, " ").trim(),
        anchor: $el.attr("id") ?? "",
      };
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push(heading);
      blocks.push({ kind: "heading", heading, path: [...stack] });
      return;
    }

    if (tag === "div" && $el.hasClass("highlight")) {
      const code = $el.find("code").first();
      const languageClass = ($el.attr("class") ?? "")
        .split(/\s+/)
        .find((c) => c.startsWith("language-"));
      const text = (code.length ? code : $el).text().replace(/\r/g, "");
      blocks.push({
        kind: "code",
        language: languageClass ? languageClass.slice("language-".length) : "",
        lines: text.split("\n").map((l) => l.replace(/\s+$/, "")),
        admonition,
        path: [...stack],
      });
      return;
    }

    if (tag === "table") {
      const rows = $el
        .find("tr")
        .toArray()
        .map((tr) => $(tr).find("th,td").toArray().map((td) => textWithBreaks($, td)));
      const header = rows.shift() ?? [];
      blocks.push({ kind: "table", header, rows, admonition, path: [...stack] });
      return;
    }

    if (tag === "p" || tag === "blockquote") {
      const text = $el.text().replace(/\s+/g, " ").trim();
      if (text) blocks.push({ kind: "para", text, admonition, path: [...stack] });
      return;
    }

    if (tag === "ul" || tag === "ol") {
      const items = $el
        .children("li")
        .toArray()
        .map((li) => $(li).text().replace(/\s+/g, " ").trim());
      blocks.push({ kind: "list", items, admonition, path: [...stack] });
      return;
    }

    if ((tag === "div" && $el.hasClass("admonition")) || tag === "details") {
      const kind = admonitionKind($el.attr("class") ?? "");
      $el.children().each((_, child) => walk(child, kind));
      return;
    }
    if (tag === "div" || tag === "section" || tag === "article" || tag === "figure") {
      $el.children().each((_, child) => walk(child, admonition));
    }
  };

  main.children().each((_, child) => walk(child, null));
  return { title, blocks };
}
