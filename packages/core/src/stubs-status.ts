// Are the installed stubs current? index.json records the ETag the docs
// server sent for index.html when the stubs were generated. One conditional
// request answers the question without a crawl: 304 means the site has not
// changed since, 200 with a different ETag means it has.

import * as path from "node:path";
import { readUtf8 } from "./fs.js";
import { type StubsResolveOptions, stubsIndexPath } from "./luarc.js";

export interface StubsSource {
  indexEtag?: string;
  indexLastModified?: string;
  pageCount?: number;
  generatorVersion?: string;
}

export interface StubsStatus {
  /** Absolute path of the index.json that was inspected. */
  indexFile: string;
  /** Version of the generator that produced the stubs, when recorded. */
  stubsVersion?: string;
  /** Number of modules in the index. */
  modules: number;
  /** ETag recorded at generation time. */
  recordedEtag?: string;
  /** ETag the server reports now, when it answered. */
  currentEtag?: string;
  status: "current" | "changed" | "unknown" | "offline";
  message: string;
}

export interface StubsStatusOptions extends StubsResolveOptions {
  /** Explicit index.json path (tests); otherwise resolved like the stubs. */
  indexPath?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Compare the recorded index.html ETag with the live one. */
export async function checkStubsStatus(options: StubsStatusOptions = {}): Promise<StubsStatus> {
  const indexFile = path.resolve(options.indexPath ?? (await stubsIndexPath(options)));
  const index = JSON.parse(await readUtf8(indexFile)) as { baseUrl: string; source?: StubsSource; modules?: unknown[] };
  const base = { indexFile, stubsVersion: index.source?.generatorVersion, modules: index.modules?.length ?? 0, recordedEtag: index.source?.indexEtag };
  if (!index.source?.indexEtag) {
    return { ...base, status: "unknown", message: "index.json records no source ETag; regenerate the stubs with a current generator to enable the check" };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${index.baseUrl}index.html`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "if-none-match": index.source.indexEtag, "user-agent": "rs3-devtools (+https://github.com/TMHSDigital/RS3-Developer-Tools)" },
      signal: controller.signal,
    });
    if (response.status === 304) {
      return {
        ...base,
        currentEtag: index.source.indexEtag,
        status: "current",
        message: `the documentation index has not changed since these stubs were generated (ETag ${index.source.indexEtag})`,
      };
    }
    const currentEtag = response.headers.get("etag") ?? undefined;
    if (response.ok && currentEtag && currentEtag === index.source.indexEtag) {
      return { ...base, currentEtag, status: "current", message: `the documentation index still carries ETag ${currentEtag}` };
    }
    if (response.ok) {
      return {
        ...base,
        currentEtag,
        status: "changed",
        message: `the documentation changed since these stubs were generated (recorded ETag ${index.source.indexEtag}, server now ${currentEtag ?? "sends none"}); update @tmhs/rs3-luals-stubs or run npm run stubs:generate`,
      };
    }
    return { ...base, status: "offline", message: `could not check: HTTP ${response.status} from ${url}` };
  } catch (error) {
    return { ...base, status: "offline", message: `could not check: ${(error as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
