/**
 * Public GitHub repository fetch — READ-ONLY, no auth token, no OAuth.
 *
 * A candidate supplies a public GitHub repo URL (https://github.com/owner/repo).
 * The server fetches it through the public GitHub API + the codeload tarball
 * endpoint, using NO credentials at all (unauthenticated GitHub rate limit:
 * 60 requests/hour — surfaced honestly in errors, never faked).
 *
 * SAFETY:
 * - Only https://github.com/<owner>/<repo> URLs are accepted (validated by
 *   parseGitHubRepoUrl). No other host, scheme, query, fragment or embedded
 *   credentials.
 * - Fetched content is UNTRUSTED input: it is never executed, never eval'd,
 *   and never passed raw to an LLM. It only feeds analyzeRepoTree, whose
 *   sanitizeForLlm output is metadata-only (see repoAnalysis.ts).
 * - Size limits refuse huge repos with a clear error instead of fetching
 *   unbounded data: repo metadata size, tarball bytes, per-file bytes,
 *   file count and total bytes are all capped.
 * - Binary files are skipped (extension list + NUL-byte heuristic).
 *
 * Tarball parsing is dependency-free: gunzip via node:zlib, then a minimal
 * ustar reader (512-byte blocks, octal sizes, ustar prefix + GNU longname).
 * The commit SHA comes from the GitHub refs API
 * (`/repos/{owner}/{repo}/git/refs/heads/{branch}`) — the tarball root is
 * `<repo>-<branch>`, not the SHA. The ref lookup is best-effort: if it
 * fails (e.g. rate limit), commitSha is null and the repo is still usable.
 */

import { gunzipSync } from "node:zlib";
import { ApiError } from "../middleware/errorHandler";
import type { RepoFile } from "./repoAnalysis";

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_CODELOAD_BASE = "https://codeload.github.com";

/** Refuse repos whose GitHub metadata size exceeds this (KB). */
export const MAX_REPO_SIZE_KB = 10 * 1024; // 10 MB
/** Refuse a downloaded tarball larger than this. */
export const MAX_TARBALL_BYTES = 15 * 1024 * 1024; // 15 MB
/** Skip any single file larger than this. */
export const MAX_FILE_BYTES = 256 * 1024; // 256 KB
/** Refuse a repo with more analysable files than this. */
export const MAX_FILES = 1000;
/** Refuse a repo whose analysable files total more than this. */
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB

/** Extensions that are binary by definition — skipped, never analysed. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "avif", "svg",
  "pdf", "zip", "gz", "tar", "xz", "7z", "rar",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi",
  "exe", "dll", "so", "dylib", "class", "pyc", "pyo", "o", "a",
  "db", "sqlite", "sqlite3", "bin", "dat", "wasm",
]);

const USER_AGENT = "GroundTruth-AI/1.0 (public-repo-analysis; no-auth)";

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  /** Canonical form: https://github.com/<owner>/<repo> */
  url: string;
}

/**
 * Strictly parse a public GitHub repo URL. Accepts an optional `.git`
 * suffix and one trailing slash; rejects everything else (other hosts,
 * http, ssh, query strings, fragments, credentials, missing parts).
 */
export function parseGitHubRepoUrl(input: string): ParsedGitHubUrl | null {
  const url = input.trim();
  const m = url.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
  );
  if (!m) return null;
  const owner = m[1] as string;
  const repo = m[2] as string;
  // github.com rejects owner/repo segments of "." / ".." and empty names;
  // the regex already excludes empty, but guard the dot-only cases.
  if (owner === "." || owner === ".." || repo === "." || repo === "..") return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export interface PublicRepoFetch {
  owner: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
  commitSha: string | null;
  files: RepoFile[];
  fileCount: number;
  totalBytes: number;
  skippedFiles: number;
  skippedBytes: number;
}

export interface FetchPublicRepoOptions {
  /** Injectable fetch (tests pass a stub; production uses global fetch). */
  fetchImpl?: typeof fetch;
}

interface GitHubRepoMeta {
  private?: boolean;
  size?: number;
  default_branch?: string;
  full_name?: string;
}

function rateLimitError(): ApiError {
  return new ApiError(
    429,
    "GitHub's unauthenticated API rate limit (60 requests/hour) has been reached. " +
      "Wait a while and try again — no data was fabricated.",
  );
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : "";
  } catch {
    return "";
  }
}

function isRateLimitResponse(res: Response, message: string): boolean {
  return (
    res.headers.get("x-ratelimit-remaining") === "0" ||
    /rate limit exceeded/i.test(message)
  );
}

function isBinaryContent(buf: Buffer): boolean {
  // NUL byte in the first 8 KB is the classic binary heuristic.
  const head = buf.subarray(0, 8192);
  return head.includes(0);
}

/** Minimal ustar tar reader: returns { path, content } for regular files. */
export function extractTar(buffer: Buffer): { path: string; content: Buffer }[] {
  const out: { path: string; content: Buffer }[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    // Two consecutive zero blocks end the archive.
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const sizeOctal = header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim();
    const size = sizeOctal === "" ? 0 : parseInt(sizeOctal, 8);
    const typeflag = String.fromCharCode(header[156] as number);
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const dataStart = offset + 512;
    const dataEnd = dataStart + (Number.isNaN(size) ? 0 : size);
    if (Number.isNaN(size) || dataEnd > buffer.length) {
      throw new ApiError(502, "GitHub returned a malformed repository archive.");
    }
    if (typeflag === "L") {
      // GNU longname: the data block is the full path of the next entry.
      pendingLongName = buffer.subarray(dataStart, dataEnd).toString("utf8").replace(/\0.*$/s, "");
    } else if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
      const fullPath = pendingLongName ?? (prefix ? `${prefix}/${name}` : name);
      out.push({ path: fullPath, content: buffer.subarray(dataStart, dataEnd) });
      pendingLongName = null;
    } else {
      // Directories ('5'), pax headers ('x'/'g'), links, etc. — skip.
      pendingLongName = null;
    }
    // Advance past the header + data rounded up to a 512-byte block.
    offset = dataStart + Math.ceil((Number.isNaN(size) ? 0 : size) / 512) * 512;
  }
  return out;
}

/**
 * Extract analysable text files from a gzip-compressed tarball buffer.
 * Also returns a commit SHA when the archive root directory happens to be
 * named `<repo>-<40-hex-sha>` (kept as a fallback for archives that do);
 * codeload itself names the root `<repo>-<branch>`, so callers resolve the
 * SHA through the refs API instead.
 */
export function extractTarGz(
  gzBuffer: Buffer,
): { files: RepoFile[]; commitSha: string | null; skippedFiles: number; skippedBytes: number } {
  let tar: Buffer;
  try {
    tar = gunzipSync(gzBuffer);
  } catch {
    throw new ApiError(502, "GitHub returned an archive that could not be decompressed.");
  }
  const entries = extractTar(tar);
  const files: RepoFile[] = [];
  let skippedFiles = 0;
  let skippedBytes = 0;
  let totalBytes = 0;
  let commitSha: string | null = null;
  for (const entry of entries) {
    // Codeload archives extract under `<repo>-<sha>/...` — strip that root.
    const segments = entry.path.split("/");
    if (commitSha === null) {
      const root = segments[0] as string;
      const m = root.match(/-([0-9a-f]{40})$/);
      if (m) commitSha = m[1] as string;
    }
    if (segments.length < 2) continue; // the root dir itself, or a bare file
    const rel = segments.slice(1).join("/");
    if (!rel || rel.endsWith("/")) continue;
    const ext = (rel.split(".").pop() ?? "").toLowerCase();
    if (BINARY_EXTENSIONS.has(ext) || isBinaryContent(entry.content)) {
      skippedFiles += 1;
      skippedBytes += entry.content.length;
      continue;
    }
    if (entry.content.length > MAX_FILE_BYTES) {
      skippedFiles += 1;
      skippedBytes += entry.content.length;
      continue;
    }
    totalBytes += entry.content.length;
    if (files.length >= MAX_FILES) {
      throw new ApiError(
        400,
        `Repository has more than ${MAX_FILES} analysable files — too large for public-URL analysis. ` +
          "Use a smaller repository.",
      );
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ApiError(
        400,
        `Repository files total more than ${MAX_TOTAL_BYTES / 1024 / 1024} MB — too large for public-URL analysis. ` +
          "Use a smaller repository.",
      );
    }
    files.push({ path: rel, content: entry.content.toString("utf8") });
  }
  if (files.length === 0 && skippedFiles === 0) {
    throw new ApiError(400, "Repository contains no analysable files.");
  }
  return { files, commitSha, skippedFiles, skippedBytes };
}

/**
 * Fetch a public GitHub repo read-only: metadata first (existence, privacy,
 * size, default branch), then the codeload tarball. No token, no OAuth.
 * Every failure is reported honestly — 404 for missing/private-or-unknown,
 * 409 for a repo GitHub reports as private, 429 for the GitHub rate limit,
 * 400 for repos over the size limits.
 */
export async function fetchPublicRepoFiles(
  repoUrl: string,
  opts: FetchPublicRepoOptions = {},
): Promise<PublicRepoFetch> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) {
    throw new ApiError(
      400,
      "Not a valid public GitHub repository URL. Use https://github.com/<owner>/<repo>.",
    );
  }
  const { owner, repo } = parsed;

  // 1) Metadata: existence, privacy, size, default branch.
  const metaRes = await fetchImpl(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
  });
  if (metaRes.status === 404) {
    throw new ApiError(
      404,
      `GitHub repository ${owner}/${repo} was not found — check the owner and name, ` +
        "or the repository may be private (private repos need a connected GitHub account, which is not set up yet).",
    );
  }
  if (metaRes.status === 403) {
    const message = await readErrorMessage(metaRes);
    if (isRateLimitResponse(metaRes, message)) throw rateLimitError();
    throw new ApiError(403, `GitHub refused the request${message ? `: ${message}` : ""}.`);
  }
  if (!metaRes.ok) {
    throw new ApiError(502, `GitHub API returned HTTP ${metaRes.status} for ${owner}/${repo}.`);
  }
  const meta = (await metaRes.json()) as GitHubRepoMeta;
  if (meta.private === true) {
    throw new ApiError(
      409,
      `Repository ${owner}/${repo} is private. Public-URL analysis only works for public repositories — ` +
        "a private repository needs a connected GitHub account, which is not set up yet.",
    );
  }
  const sizeKb = typeof meta.size === "number" ? meta.size : 0;
  if (sizeKb > MAX_REPO_SIZE_KB) {
    throw new ApiError(
      400,
      `Repository ${owner}/${repo} is ${(sizeKb / 1024).toFixed(1)} MB — over the ` +
        `${MAX_REPO_SIZE_KB / 1024} MB limit for public-URL analysis. Use a smaller repository.`,
    );
  }
  const defaultBranch = meta.default_branch ?? "main";

  // 2) Tarball (one request, no per-file API calls — kind to the 60/hr limit).
  const tarRes = await fetchImpl(
    `${GITHUB_CODELOAD_BASE}/${owner}/${repo}/tar.gz/${encodeURIComponent(defaultBranch)}`,
    { headers: { "User-Agent": USER_AGENT } },
  );
  if (tarRes.status === 404) {
    throw new ApiError(
      404,
      `GitHub repository ${owner}/${repo} was not found — check the owner and name, ` +
        "or the repository may be private.",
    );
  }
  if (tarRes.status === 403) {
    const message = await readErrorMessage(tarRes);
    if (isRateLimitResponse(tarRes, message)) throw rateLimitError();
    throw new ApiError(403, `GitHub refused the archive download${message ? `: ${message}` : ""}.`);
  }
  if (!tarRes.ok) {
    throw new ApiError(502, `GitHub archive download returned HTTP ${tarRes.status} for ${owner}/${repo}.`);
  }
  const gzBuffer = Buffer.from(await tarRes.arrayBuffer());
  if (gzBuffer.length > MAX_TARBALL_BYTES) {
    throw new ApiError(
      400,
      `Repository archive is ${(gzBuffer.length / 1024 / 1024).toFixed(1)} MB — over the ` +
        `${MAX_TARBALL_BYTES / 1024 / 1024} MB limit for public-URL analysis.`,
    );
  }
  const { files, commitSha: tarSha, skippedFiles, skippedBytes } = extractTarGz(gzBuffer);
  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, "utf8"), 0);
  // Commit SHA via the refs API (best-effort — a failure leaves it null
  // rather than failing an otherwise good fetch).
  let commitSha: string | null = tarSha;
  if (!commitSha) {
    try {
      const refRes = await fetchImpl(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(defaultBranch)}`,
        { headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT } },
      );
      if (refRes.ok) {
        const ref = (await refRes.json()) as { object?: { sha?: unknown } };
        const sha = ref.object?.sha;
        if (typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha)) commitSha = sha;
      }
    } catch {
      // Best-effort only — the repo was already fetched successfully.
    }
  }
  return {
    owner,
    repo,
    repoUrl: parsed.url,
    defaultBranch,
    commitSha,
    files,
    fileCount: files.length,
    totalBytes,
    skippedFiles,
    skippedBytes,
  };
}
