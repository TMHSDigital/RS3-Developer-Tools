// Converts a documentation page to plain text with light Markdown structure so
// the MCP server can return readable content to an agent. The result is only
// ever returned at runtime; it is not written anywhere except the user's cache.

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export interface DocsSection {
  /** Heading text with the trailing paragraph marker removed. */
  heading: string;
  level: number;
  anchor: string;
  /** Zero-based line of the heading in DocsPageText.text, so a section can be sliced by offset. */
  line: number;
}

export interface DocsPageText {
  title: string;
  text: string;
  sections: DocsSection[];
}

const BR_PLACEHOLDER = "\u0001";

/** Wrap inline <code> in backticks so signatures inside prose and cells stay recognisable. */
function markInlineCode($: cheerio.CheerioAPI, clone: cheerio.Cheerio<AnyNode>): void {
  clone.find("code").each((_, code) => {
    const text = $(code).text().replace(/\s+/g, " ").trim();
    $(code).replaceWith(text ? "`" + text + "`" : "");
  });
}

/** Inline text of an element with whitespace collapsed and <code> marked. */
function inlineText($: cheerio.CheerioAPI, el: AnyNode): string {
  const clone = $(el).clone();
  markInlineCode($, clone);
  return clone.text().replace(/\s+/g, " ").trim();
}

/** Text of a table cell with <br> turned into " / " so multi-line cells stay readable. */
function cellText($: cheerio.CheerioAPI, el: AnyNode): string {
  const clone = $(el).clone();
  clone.find("br").replaceWith(BR_PLACEHOLDER);
  markInlineCode($, clone);
  return clone
    .text()
    .split(BR_PLACEHOLDER)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
    .join(" / ");
}

/** Extract the navigation links (relative .html paths) from a docs page. */
export function extractNavLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("nav.md-nav a.md-nav__link[href], .md-sidebar a[href]").each((_, a) => {
    const href = ($(a).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^https?:/i.test(href)) return;
    const clean = href
      .replace(/^(\.\.\/)+/, "")
      .replace(/^\.\//, "")
      .split("#")[0]!;
    if (clean.endsWith(".html")) links.add(clean);
  });
  return [...links].sort();
}

/** Page title without the site suffix. */
export function docsPageTitle(html: string): string {
  const $ = cheerio.load(html);
  return $("title")
    .first()
    .text()
    .replace(/\s*-\s*RuneScape Client API\s*$/i, "")
    .trim();
}

/** Render the main article of a docs page as structured plain text. */
export function docsPageToText(html: string): DocsPageText {
  const $ = cheerio.load(html);
  const main = $(".md-content__inner").first();
  const title = docsPageTitle(html);
  const sections: DocsSection[] = [];
  const lines: string[] = [];

  // Lists may nest: the item text is everything except its own sub-lists,
  // which follow it indented.
  const renderList = ($list: cheerio.Cheerio<AnyNode>, depth: number): void => {
    $list.children("li").each((_, li) => {
      const clone = $(li).clone();
      clone.children("ul, ol").remove();
      markInlineCode($, clone);
      const text = clone.text().replace(/\s+/g, " ").trim();
      if (text) lines.push("  ".repeat(depth) + "- " + text);
      $(li)
        .children("ul, ol")
        .each((_, nested) => renderList($(nested), depth + 1));
    });
  };

  const walk = (el: AnyNode): void => {
    const $el = $(el);
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (!tag) return;
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const heading = $el.text().replace(/¶/g, "").trim();
      sections.push({ heading, level, anchor: $el.attr("id") ?? "", line: -1 });
      lines.push("", "#".repeat(level) + " " + heading, "");
      return;
    }
    if (tag === "dl") {
      $el.children("dt, dd").each((_, item) => {
        const itemTag = (item as { tagName?: string }).tagName?.toLowerCase();
        const text = inlineText($, item);
        if (!text) return;
        lines.push(itemTag === "dt" ? "- " + text : "  " + text);
      });
      lines.push("");
      return;
    }
    if (tag === "p" && $el.hasClass("admonition-title")) {
      const text = inlineText($, el);
      if (text) lines.push("**" + text + "**", "");
      return;
    }
    if (tag === "table") {
      $el.find("tr").each((_, tr) => {
        const cells = $(tr)
          .find("th,td")
          .toArray()
          .map((td) => cellText($, td));
        lines.push("| " + cells.join(" | ") + " |");
      });
      lines.push("");
      return;
    }
    if ((tag === "div" && $el.hasClass("highlight")) || tag === "pre") {
      lines.push("```", $el.text().replace(/\s+$/, ""), "```", "");
      return;
    }
    if (tag === "p" || tag === "summary" || tag === "blockquote") {
      const text = inlineText($, el);
      if (text) lines.push(text, "");
      return;
    }
    if (tag === "ul" || tag === "ol") {
      renderList($el, 0);
      lines.push("");
      return;
    }
    if (tag === "div" || tag === "details" || tag === "section" || tag === "article") {
      $el.children().each((_, child) => walk(child));
    }
  };

  main.children().each((_, child) => walk(child));
  const text =
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n";
  // Locate each heading in the final text in document order, so two sections
  // with the same heading (a repeated "Properties") get their own offsets.
  const finalLines = text.split("\n");
  let cursor = 0;
  for (const section of sections) {
    const marker = "#".repeat(section.level) + " " + section.heading;
    const at = finalLines.indexOf(marker, cursor);
    section.line = at === -1 ? cursor : at;
    if (at !== -1) cursor = at + 1;
  }
  return { title, text, sections };
}
