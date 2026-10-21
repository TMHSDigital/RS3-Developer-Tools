// Fetches pages from developer.runescape.com with a per-user ETag cache.
//
// The documentation is copyrighted by Jagex, so page content is only ever
// stored in the user's local cache folder (see cacheDir()), never in a
// repository. A page can also be read from an offline mirror directory, which
// the test-suite uses with synthetic fixture pages.

import * as path from "node:path";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { cacheDir } from "./paths.js";
import { readUtf8, writeUtf8NoBom, pathExists } from "./fs.js";

export const DOCS_BASE_URL = "https://developer.runescape.com/rs/";

export interface DocsClientOptions {
  /** Base URL of the docs site. Defaults to the official site. */
  baseUrl?: string;
  /** Read pages from this directory (mirrored layout) instead of the network. */
  offlineDir?: string;
  /** Cache directory. Defaults to cacheDir()/docs. */
  cacheRoot?: string;
  /** Skip the network and serve only cached pages. */
  cacheOnly?: boolean;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Treat cached entries younger than this many seconds as fresh (no conditional request). */
  maxAgeSeconds?: number;
}

export interface DocsPage {
  /** Path relative to the docs root, for example "core/persistentdb.html". */
  relPath: string;
  url: string;
  html: string;
  source: "network" | "cache" | "offline";
  etag?: string;
}

interface CacheMeta {
  url: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: string;
}

/** Normalise a docs reference (full URL, "./x.html", "x.html", "x") to a relative page path. */
export function normaliseDocsPath(ref: string, baseUrl: string = DOCS_BASE_URL): string {
  let rel = ref.trim();
  if (/^https?:\/\//i.test(rel)) {
    if (!rel.startsWith(baseUrl)) {
      throw new Error(`Only pages under ${baseUrl} can be fetched (got ${ref}).`);
    }
    rel = rel.slice(baseUrl.length);
  }
  rel = rel.replace(/^\.?\//, "").split("#")[0]!.split("?")[0]!;
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (!rel.endsWith(".html")) rel += ".html";
  if (rel.split("/").includes("..")) throw new Error(`Invalid docs path: ${ref}`);
  return rel;
}

export class DocsClient {
  readonly baseUrl: string;
  private readonly offlineDir?: string;
  private readonly cacheRoot: string;
  private readonly cacheOnly: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAgeSeconds: number;

  constructor(options: DocsClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DOCS_BASE_URL;
    this.offlineDir = options.offlineDir;
    this.cacheRoot = options.cacheRoot ?? path.join(cacheDir(), "docs");
    this.cacheOnly = options.cacheOnly ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 0;
  }

  urlFor(relPath: string): string {
    return this.baseUrl + normaliseDocsPath(relPath, this.baseUrl);
  }

  private cachePaths(url: string): { html: string; meta: string } {
    const key = createHash("sha1").update(url).digest("hex");
    return {
      html: path.join(this.cacheRoot, `${key}.html`),
      meta: path.join(this.cacheRoot, `${key}.meta.json`),
    };
  }

  private async readCache(url: string): Promise<{ html: string; meta: CacheMeta } | undefined> {
    const paths = this.cachePaths(url);
    if (!(await pathExists(paths.html)) || !(await pathExists(paths.meta))) return undefined;
    try {
      const html = await readUtf8(paths.html);
      const meta = JSON.parse(await readUtf8(paths.meta)) as CacheMeta;
      return { html, meta };
    } catch {
      return undefined;
    }
  }

  private async writeCache(url: string, html: string, meta: CacheMeta): Promise<void> {
    const paths = this.cachePaths(url);
    await writeUtf8NoBom(paths.html, html);
    await writeUtf8NoBom(paths.meta, JSON.stringify(meta, null, 2) + "\n");
  }

  /** Fetch one page, honouring the offline mirror, the ETag cache, and cache-only mode. */
  async getPage(ref: string): Promise<DocsPage> {
    const relPath = normaliseDocsPath(ref, this.baseUrl);
    const url = this.baseUrl + relPath;

    if (this.offlineDir) {
      const file = path.join(this.offlineDir, ...relPath.split("/"));
      const html = await readUtf8(file);
      return { relPath, url, html, source: "offline" };
    }

    const cached = await this.readCache(url);
    if (cached && this.maxAgeSeconds > 0) {
      const ageMs = Date.now() - Date.parse(cached.meta.fetchedAt);
      if (ageMs >= 0 && ageMs < this.maxAgeSeconds * 1000) {
        return { relPath, url, html: cached.html, source: "cache", etag: cached.meta.etag };
      }
    }
    if (this.cacheOnly) {
      if (cached) return { relPath, url, html: cached.html, source: "cache", etag: cached.meta.etag };
      throw new Error(`Page not in cache and cache-only mode is on: ${url}`);
    }

    const headers: Record<string, string> = {
      "user-agent": "rs3-devtools (+https://github.com/TMHSDigital/RS3-Developer-Tools)",
    };
    if (cached?.meta.etag) headers["if-none-match"] = cached.meta.etag;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers });
    } catch (error) {
      if (cached) return { relPath, url, html: cached.html, source: "cache", etag: cached.meta.etag };
      throw new Error(`Failed to fetch ${url}: ${(error as Error).message}`);
    }

    if (response.status === 304 && cached) {
      await this.writeCache(url, cached.html, { ...cached.meta, fetchedAt: new Date().toISOString() });
      return { relPath, url, html: cached.html, source: "cache", etag: cached.meta.etag };
    }
    if (!response.ok) {
      if (cached) return { relPath, url, html: cached.html, source: "cache", etag: cached.meta.etag };
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }
    const html = await response.text();
    const meta: CacheMeta = {
      url,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      fetchedAt: new Date().toISOString(),
    };
    await this.writeCache(url, html, meta);
    return { relPath, url, html, source: "network", etag: meta.etag };
  }

  /** Remove every cached page. */
  async clearCache(): Promise<void> {
    await fsp.rm(this.cacheRoot, { recursive: true, force: true });
  }
}
