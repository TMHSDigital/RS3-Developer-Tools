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
}

export interface DocsPageText {
  title: string;
  text: string;
  sections: DocsSection[];
}

const BR_PLACEHOLDER = "\u0001";

/** Text of a table cell with <br> turned into " / " so multi-line cells stay readable. */
function cellText($: cheerio.CheerioAPI, el: AnyNode): string {
  const clone = $(el).clone();
  clone.find("br").replaceWith(BR_PLACEHOLDER);
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
    const clean = href.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "").split("#")[0]!;
    if (clean.endsWith(".html")) links.add(clean);
  });
  return [...links].sort();
}

/** Page title without the site suffix. */
export function docsPageTitle(html: string): string {
  const $ = cheerio.load(html);
  return $("title").first().text().replace(/\s*-\s*RuneScape Client API\s*$/i, "").trim();
}

/** Render the main article of a docs page as structured plain text. */
export function docsPageToText(html: string): DocsPageText {
  const $ = cheerio.load(html);
  const main = $(".md-content__inner").first();
  const title = docsPageTitle(html);
  const sections: DocsSection[] = [];
  const lines: string[] = [];

  const walk = (el: AnyNode): void => {
    const $el = $(el);
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (!tag) return;
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const heading = $el.text().replace(/¶/g, "").trim();
      sections.push({ heading, level, anchor: $el.attr("id") ?? "" });
      lines.push("", "#".repeat(level) + " " + heading, "");
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
      const text = $el.text().replace(/\s+/g, " ").trim();
      if (text) lines.push(text, "");
      return;
    }
    if (tag === "ul" || tag === "ol") {
      $el.children("li").each((_, li) => {
        lines.push("- " + $(li).text().replace(/\s+/g, " ").trim());
      });
      lines.push("");
      return;
    }
    if (tag === "div" || tag === "details" || tag === "section" || tag === "article") {
      $el.children().each((_, child) => walk(child));
    }
  };

  main.children().each((_, child) => walk(child));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { title, text, sections };
}
