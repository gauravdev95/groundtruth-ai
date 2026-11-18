/**
 * Deterministic repository analysis — NO execution, NO network.
 *
 * The input is a list of { path, content } files supplied by the caller
 * (e.g. fetched from a validated repo URL by a worker). Analysis is pure
 * pattern matching over paths, file names and dependency manifests.
 * Everything returned is pure JSON-serialisable metadata.
 *
 * PROMPT-INJECTION DEFENCE: `sanitizeForLlm` returns ONLY derived
 * counts/names (languages, frameworks, dependency names, endpoint paths,
 * counts). It NEVER includes raw file contents, README text, comments or
 * code — a malicious string planted in a README (e.g. "ignore previous
 * instructions") therefore cannot reach an LLM prompt through this module.
 */

export interface RepoFile {
  path: string;
  content: string;
}

export interface LanguageStat {
  language: string;
  bytes: number;
  files: number;
  percent: number;
}

export interface Dependency {
  name: string;
  version: string | null;
  source: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
}

export interface RepoAnalysis {
  fileCount: number;
  totalBytes: number;
  languages: LanguageStat[];
  frameworks: string[];
  dependencies: Dependency[];
  structure: { topLevelDirs: string[]; maxDepth: number };
  entryPoints: string[];
  tests: { count: number; frameworks: string[]; files: string[] };
  endpoints: ApiEndpoint[];
  dbIntegrations: string[];
  hasAuth: boolean;
  hasValidation: boolean;
  hasRateLimiter: boolean;
  quality: {
    todoCount: number;
    fixmeCount: number;
    avgFileSizeBytes: number;
    largestFiles: { path: string; bytes: number }[];
    emptyFiles: string[];
  };
  functionality: string[];
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C",
  kt: "Kotlin",
  swift: "Swift",
  html: "HTML",
  css: "CSS",
  scss: "CSS",
  sql: "SQL",
  sh: "Shell",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  toml: "TOML",
};

/** Dependency name → framework label. */
const FRAMEWORK_DEPS: Record<string, string> = {
  react: "React",
  next: "Next.js",
  vue: "Vue",
  "@angular/core": "Angular",
  svelte: "Svelte",
  express: "Express",
  fastify: "Fastify",
  nestjs: "NestJS",
  "@nestjs/core": "NestJS",
  fastapi: "FastAPI",
  django: "Django",
  flask: "Flask",
  rails: "Rails",
  laravel: "Laravel",
  spring: "Spring",
  "spring-boot": "Spring Boot",
  gin: "Gin",
  fiber: "Fiber",
  actix: "Actix",
  rocket: "Rocket",
  axum: "Axum",
  "react-native": "React Native",
  electron: "Electron",
  tailwindcss: "Tailwind CSS",
};

const DB_MARKERS: Record<string, string> = {
  pg: "PostgreSQL (pg)",
  postgres: "PostgreSQL",
  prisma: "Prisma",
  mongoose: "MongoDB (Mongoose)",
  mongodb: "MongoDB",
  mysql2: "MySQL",
  mysql: "MySQL",
  sqlite3: "SQLite",
  "better-sqlite3": "SQLite",
  redis: "Redis",
  ioredis: "Redis",
  sqlalchemy: "SQLAlchemy",
  psycopg2: "PostgreSQL (psycopg2)",
  pymongo: "MongoDB (PyMongo)",
  "typeorm": "TypeORM",
  sequelize: "Sequelize",
  knex: "Knex",
  drizzle: "Drizzle",
};

const TEST_FRAMEWORK_DEPS: Record<string, string> = {
  jest: "Jest",
  vitest: "Vitest",
  mocha: "Mocha",
  pytest: "pytest",
  unittest: "unittest",
  rspec: "RSpec",
  junit: "JUnit",
  "go test": "Go test",
  cypress: "Cypress",
  playwright: "Playwright",
};

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function depNames(obj: unknown): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  return Object.keys(obj as Record<string, unknown>);
}

function collectDependencies(files: RepoFile[]): Dependency[] {
  const byKey = new Map<string, Dependency>();
  const add = (name: string, version: string | null, source: string) => {
    const key = `${name}@${source}`;
    if (!byKey.has(key)) byKey.set(key, { name, version, source });
  };
  for (const f of files) {
    const base = f.path.split("/").pop() ?? "";
    if (base === "package.json") {
      const pkg = parseJsonSafe(f.content);
      if (pkg) {
        for (const section of ["dependencies", "devDependencies"]) {
          const deps = pkg[section] as Record<string, unknown> | undefined;
          if (deps) {
            for (const [name, ver] of Object.entries(deps)) {
              add(name, typeof ver === "string" ? ver : null, "package.json");
            }
          }
        }
      }
    } else if (base === "requirements.txt") {
      for (const line of f.content.split("\n")) {
        const m = line.trim().match(/^([A-Za-z0-9_.-]+)\s*(?:[=<>!~]+(.*))?$/);
        if (m && m[1] && !m[1].startsWith("#")) {
          add(m[1] as string, m[2]?.trim() || null, "requirements.txt");
        }
      }
    } else if (base === "go.mod") {
      for (const line of f.content.split("\n")) {
        const m = line.trim().match(/^(?:require\s+)?([a-z0-9./_-]+\.[a-z]{2,}\/[^\s]+)\s+v?([^\s]+)/i);
        if (m) add(m[1] as string, m[2] ?? null, "go.mod");
      }
    } else if (base === "Cargo.toml") {
      const inDeps = f.content.split("\n").some((l) => l.trim() === "[dependencies]");
      if (inDeps) {
        for (const line of f.content.split("\n")) {
          const m = line.trim().match(/^([A-Za-z0-9_-]+)\s*=/);
          if (m) add(m[1] as string, null, "Cargo.toml");
        }
      }
    } else if (base === "Gemfile") {
      for (const line of f.content.split("\n")) {
        const m = line.trim().match(/^gem\s+['"]([^'"]+)['"]/);
        if (m) add(m[1] as string, null, "Gemfile");
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function detectTests(files: RepoFile[], deps: Dependency[]): RepoAnalysis["tests"] {
  const testFiles = files
    .map((f) => f.path)
    .filter((p) => {
      const base = p.split("/").pop() ?? "";
      return (
        /(^|\.)(test|spec)\.(ts|tsx|js|jsx|py|go|rb|java)$/i.test(base) ||
        base.startsWith("test_") ||
        base.endsWith("_test.go") ||
        /[/\\](tests?|__tests__|spec)[/\\]/.test(p)
      );
    });
  const frameworks = new Set<string>();
  for (const d of deps) {
    const label = TEST_FRAMEWORK_DEPS[d.name.toLowerCase()];
    if (label) frameworks.add(label);
  }
  for (const p of testFiles) {
    if (p.endsWith("_test.go")) frameworks.add("Go test");
    if (p.includes("pytest") || p.endsWith("test_.py")) frameworks.add("pytest");
  }
  return { count: testFiles.length, frameworks: [...frameworks].sort(), files: testFiles };
}

function detectEndpoints(files: RepoFile[]): ApiEndpoint[] {
  const seen = new Set<string>();
  const out: ApiEndpoint[] = [];
  const add = (method: string, path: string) => {
    const key = `${method} ${path}`;
    if (!seen.has(key) && path.startsWith("/")) {
      seen.add(key);
      out.push({ method, path });
    }
  };
  // Express / Fastify / Koa: app.get('/path'), router.post("/path", ...)
  const jsRoute = /(?:app|router|server)\.(get|post|put|patch|delete|all)\s*\(\s*['"`](\/[^'"`?]+)['"`]/g;
  // Flask / FastAPI decorators: @app.route('/path', methods=['GET'])
  const pyRoute =
    /@(?:app|router|blueprint)\.(?:route|get|post|put|patch|delete)\s*\(\s*['"`](\/[^'"`?]+)['"`]/g;
  // FastAPI with methods kwarg: @app.route("/x", methods=["POST"])
  const pyRouteMethods =
    /@(?:app|router)\.route\s*\(\s*['"`](\/[^'"`?]+)['"`][^)]*methods\s*=\s*\[([^\]]+)\]/g;
  // Go: r.GET("/path"), mux.HandleFunc("/path", ...)
  const goRoute = /\.(?:GET|POST|PUT|PATCH|DELETE|HandleFunc)\s*\(\s*"(\/[^"]*)"/g;
  for (const f of files) {
    for (const m of f.content.matchAll(jsRoute)) {
      add((m[1] as string).toUpperCase(), m[2] as string);
    }
    for (const m of f.content.matchAll(pyRoute)) {
      // @app.route defaults to GET; @app.get is GET, etc.
      add("GET", m[1] as string);
    }
    for (const m of f.content.matchAll(pyRouteMethods)) {
      const methods = (m[2] as string).match(/[A-Z]+/g) ?? ["GET"];
      for (const meth of methods) add(meth, m[1] as string);
    }
    for (const m of f.content.matchAll(goRoute)) {
      add("GET", m[1] as string);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function detectEntryPoints(files: RepoFile[]): string[] {
  const entries: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const f of files) {
    if (f.path.split("/").pop() === "package.json") {
      const pkg = parseJsonSafe(f.content);
      const scripts = pkg?.scripts as Record<string, unknown> | undefined;
      if (scripts) {
        for (const [name, cmd] of Object.entries(scripts)) {
          if (typeof cmd === "string") entries.push(`package.json script "${name}": ${cmd}`);
        }
      }
      const main = pkg?.main;
      if (typeof main === "string") entries.push(`package.json main: ${main}`);
    }
  }
  for (const candidate of ["main.py", "app.py", "index.js", "index.ts", "src/index.ts", "src/main.ts", "manage.py", "main.go", "cmd/main.go"]) {
    if (byPath.has(candidate)) entries.push(candidate);
  }
  for (const f of files) {
    if (f.path.split("/").pop() === "Dockerfile") {
      for (const line of f.content.split("\n")) {
        const m = line.trim().match(/^(CMD|ENTRYPOINT)\s+(.+)$/);
        if (m) entries.push(`Dockerfile ${m[1]}: ${m[2]}`);
      }
    }
  }
  return [...new Set(entries)];
}

export function analyzeRepoTree(files: RepoFile[]): RepoAnalysis {
  const totalBytes = files.reduce((sum, f) => sum + byteLength(f.content), 0);
  const langMap = new Map<string, { bytes: number; files: number }>();
  for (const f of files) {
    const ext = (f.path.split(".").pop() ?? "").toLowerCase();
    const lang = EXTENSION_LANGUAGES[ext] ?? "Other";
    const cur = langMap.get(lang) ?? { bytes: 0, files: 0 };
    cur.bytes += byteLength(f.content);
    cur.files += 1;
    langMap.set(lang, cur);
  }
  const languages: LanguageStat[] = [...langMap.entries()]
    .map(([language, v]) => ({
      language,
      bytes: v.bytes,
      files: v.files,
      percent: totalBytes === 0 ? 0 : Math.round((v.bytes / totalBytes) * 1000) / 10,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const dependencies = collectDependencies(files);
  const depNamesLower = dependencies.map((d) => d.name.toLowerCase());
  const frameworks = [...new Set(
    dependencies
      .map((d) => FRAMEWORK_DEPS[d.name.toLowerCase()] ?? FRAMEWORK_DEPS[d.name])
      .filter((x): x is string => Boolean(x)),
  )].sort();
  // Also detect frameworks from imports in source files (e.g. `from fastapi import`).
  const allContent = files.map((f) => f.content).join("\n");
  if (/from\s+fastapi\s+import|import\s+fastapi/.test(allContent) && !frameworks.includes("FastAPI")) {
    frameworks.push("FastAPI");
    frameworks.sort();
  }
  if (/from\s+flask\s+import|import\s+flask/.test(allContent) && !frameworks.includes("Flask")) {
    frameworks.push("Flask");
    frameworks.sort();
  }
  if (/from\s+django|import\s+django/.test(allContent) && !frameworks.includes("Django")) {
    frameworks.push("Django");
    frameworks.sort();
  }

  const topLevelDirs = [...new Set(
    files
      .filter((f) => f.path.includes("/"))
      .map((f) => f.path.split("/")[0] as string),
  )].sort();
  const maxDepth = files.reduce(
    (max, f) => Math.max(max, f.path.split("/").length - 1),
    0,
  );

  const tests = detectTests(files, dependencies);
  const endpoints = detectEndpoints(files);
  const entryPoints = detectEntryPoints(files);

  const dbIntegrations = [...new Set(
    dependencies
      .map((d) => DB_MARKERS[d.name.toLowerCase()])
      .filter((x): x is string => Boolean(x)),
  )].sort();

  const hasAuth =
    depNamesLower.some((n) => /passport|jsonwebtoken|bcrypt|auth0|next-auth|oauth|jwt/.test(n)) ||
    endpoints.some((e) => /auth|login|signup|register/.test(e.path));
  const hasValidation =
    depNamesLower.some((n) => /zod|joi|validator|express-validator|class-validator|pydantic|yup/.test(n));
  const hasRateLimiter =
    depNamesLower.some((n) => /rate-limit|limiter|throttl/.test(n)) ||
    /express-rate-limit|rateLimit\(|slowDown/.test(allContent) ||
    // Stdlib / hand-rolled limiters: a file or class named *rate*limit*.
    files.some((f) => /rate[_-]?limit/i.test(f.path)) ||
    /class \w*RateLimit\w*/.test(allContent);

  let todoCount = 0;
  let fixmeCount = 0;
  for (const f of files) {
    todoCount += (f.content.match(/TODO/g) ?? []).length;
    fixmeCount += (f.content.match(/FIXME/g) ?? []).length;
  }
  const largestFiles = files
    .map((f) => ({ path: f.path, bytes: byteLength(f.content) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
  const emptyFiles = files.filter((f) => f.content.trim() === "").map((f) => f.path);

  const functionality: string[] = [];
  if (frameworks.length > 0) functionality.push(`Built with ${frameworks.join(", ")}.`);
  if (endpoints.length > 0) {
    functionality.push(`Exposes ${endpoints.length} API endpoint${endpoints.length === 1 ? "" : "s"}.`);
  }
  if (tests.count > 0) {
    functionality.push(`Has ${tests.count} test file${tests.count === 1 ? "" : "s"}${tests.frameworks.length ? ` (${tests.frameworks.join(", ")})` : ""}.`);
  } else {
    functionality.push("Has no test files.");
  }
  if (dbIntegrations.length > 0) functionality.push(`Uses ${dbIntegrations.join(", ")}.`);
  if (hasAuth) functionality.push("Includes authentication.");
  if (!hasAuth && endpoints.length > 0) functionality.push("No authentication detected on API endpoints.");
  if (entryPoints.length > 0) functionality.push(`Entry point: ${entryPoints[0]}.`);
  if (functionality.length === 0) functionality.push("No recognisable functionality detected from metadata.");

  return {
    fileCount: files.length,
    totalBytes,
    languages,
    frameworks,
    dependencies,
    structure: { topLevelDirs, maxDepth },
    entryPoints,
    tests,
    endpoints,
    dbIntegrations,
    hasAuth,
    hasValidation,
    hasRateLimiter,
    quality: {
      todoCount,
      fixmeCount,
      avgFileSizeBytes: files.length === 0 ? 0 : Math.round(totalBytes / files.length),
      largestFiles,
      emptyFiles,
    },
    functionality,
  };
}

/**
 * Metadata-only summary for LLM prompts.
 *
 * PROMPT-INJECTION DEFENCE: only derived counts and names are included —
 * languages, frameworks, dependency names, endpoint paths, directory
 * names, counts. Raw file contents, README text, comments and code are
 * NEVER included, so injected instructions in repo files cannot reach
 * the model through this string.
 */
export function sanitizeForLlm(analysis: RepoAnalysis): string {
  const lines: string[] = [
    "Repository summary (metadata only — no file contents):",
    `Files: ${analysis.fileCount}, total size: ${analysis.totalBytes} bytes.`,
    `Languages: ${analysis.languages.map((l) => `${l.language} (${l.percent}%, ${l.files} files)`).join(", ") || "none detected"}.`,
    `Frameworks: ${analysis.frameworks.join(", ") || "none detected"}.`,
    `Dependencies: ${analysis.dependencies.map((d) => d.name).join(", ") || "none"}.`,
    `Top-level directories: ${analysis.structure.topLevelDirs.join(", ") || "none"}. Max depth: ${analysis.structure.maxDepth}.`,
    `Entry points: ${analysis.entryPoints.join("; ") || "none detected"}.`,
    `Tests: ${analysis.tests.count} file(s)${analysis.tests.frameworks.length ? `, frameworks: ${analysis.tests.frameworks.join(", ")}` : ""}.`,
    `API endpoints: ${analysis.endpoints.length} (${analysis.endpoints.map((e) => `${e.method} ${e.path}`).join(", ") || "none"}).`,
    `Databases: ${analysis.dbIntegrations.join(", ") || "none detected"}.`,
    `Auth: ${analysis.hasAuth ? "present" : "not detected"}; validation: ${analysis.hasValidation ? "present" : "not detected"}; rate limiter: ${analysis.hasRateLimiter ? "present" : "not detected"}.`,
    `Code quality: ${analysis.quality.todoCount} TODO(s), ${analysis.quality.fixmeCount} FIXME(s), avg file size ${analysis.quality.avgFileSizeBytes} bytes, ${analysis.quality.emptyFiles.length} empty file(s).`,
    `Functionality: ${analysis.functionality.join(" ")}`,
  ];
  return lines.join("\n");
}

export interface RepoAccessCheck {
  ok: boolean;
  issues: string[];
}

/**
 * Allow only https GitHub/GitLab repo URLs or local file lists.
 * Rejects other schemes, credentials embedded in a URL, and any file
 * path that escapes the workspace (../ segments or absolute paths).
 */
export function validateRepoAccess(input: {
  repoUrl?: string;
  files?: RepoFile[];
}): RepoAccessCheck {
  const issues: string[] = [];
  if (input.repoUrl !== undefined) {
    const url = input.repoUrl.trim();
    const m = url.match(
      /^https:\/\/(github\.com|gitlab\.com)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?\/?$/,
    );
    if (!m) {
      issues.push(
        "repoUrl must be an https GitHub or GitLab repository URL (https://github.com/owner/repo or https://gitlab.com/owner/repo)",
      );
    }
    if (/@/.test(url.split("/").slice(0, 3).join("/"))) {
      issues.push("repoUrl must not contain credentials");
    }
    if (/[?#]/.test(url)) issues.push("repoUrl must not contain query strings or fragments");
  }
  if (input.files !== undefined) {
    for (const f of input.files) {
      const p = f.path;
      if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\")) {
        issues.push(`absolute path not allowed: ${p}`);
      }
      const segments = p.split(/[\\/]+/);
      if (segments.includes("..")) {
        issues.push(`path escapes the workspace: ${p}`);
      }
      if (!p.trim()) issues.push("empty file path");
    }
  }
  if (input.repoUrl === undefined && input.files === undefined) {
    issues.push("provide repoUrl or files");
  }
  return { ok: issues.length === 0, issues };
}
