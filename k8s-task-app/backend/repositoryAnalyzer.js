const fs = require("fs");
const path = require("path");

const TEXT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".yaml", ".yml", ".md"]);
const EXCLUDED = new Set(["node_modules", ".git", "dist", "build"]);
const URL_RE = /https?:\/\/[^\s"'`)>]+/g;
const CLIENT_RE = /\b(fetch|axios|pg|express|grpc|GraphQL|Anthropic|OpenAI|boto3|requests|httpx)\b/gi;
const ROUTE_RE = /(?:app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)/gi;
const AUTH_RE = /authorization|bearer|oauth|api[_-]?key|jwt|session|kerberos|gssapi/i;

function filesUnder(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(fullPath));
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function scanSources(sourceFiles, scope) {
  const endpointUsage = [];
  const externalHosts = new Map();
  const clientLibraries = new Map();
  const files = [];
  let totalLines = 0;

  for (const file of sourceFiles) {
    const source = file.source;
    const relativeFile = file.path;
    const urls = [...new Set(source.match(URL_RE) || [])];
    const routes = [];
    for (const match of source.matchAll(ROUTE_RE)) {
      routes.push({ method: match[1].toUpperCase(), path: match[2], file: relativeFile });
      endpointUsage.push(routes.at(-1));
    }
    for (const url of urls) {
      const host = url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
      externalHosts.set(host, (externalHosts.get(host) || 0) + 1);
    }
    for (const match of source.matchAll(CLIENT_RE)) {
      const name = match[1].toLowerCase();
      clientLibraries.set(name, (clientLibraries.get(name) || 0) + 1);
    }
    totalLines += source.split("\n").length;
    if (urls.length || routes.length || CLIENT_RE.test(source)) {
      files.push({ file: relativeFile, lines: source.split("\n").length, urls, routes });
    }
  }

  return {
    scope,
    scanned_files: files.length,
    total_lines: totalLines,
    api_usage: {
      endpoint_count: endpointUsage.length,
      endpoints: endpointUsage,
      external_hosts: [...externalHosts.entries()].sort((a, b) => b[1] - a[1]).map(([host, references]) => ({ host, references })),
      client_libraries: [...clientLibraries.entries()].sort((a, b) => b[1] - a[1]).map(([library, references]) => ({ library, references })),
      files_with_auth_signals: sourceFiles.filter((item) => AUTH_RE.test(item.source)).map((item) => item.path)
    },
    files
  };
}

function scanRepository(root) {
  return scanSources(
    filesUnder(root).map((filePath) => ({
      path: path.relative(root, filePath).replaceAll(path.sep, "/"),
      source: fs.readFileSync(filePath, "utf8")
    })),
    "Task Manager backend"
  );
}

async function claudeSummary(report) {
  if (!process.env.ANTHROPIC_API_KEY) return "Claude enrichment skipped: ANTHROPIC_API_KEY is not configured.";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
      max_tokens: 700,
      temperature: 0,
      messages: [{ role: "user", content: `Review this Task Manager API report. Return exactly three short sections: Key findings, Risks/gaps, Next actions.\n\n${JSON.stringify({ ...report, files: undefined }, null, 2)}` }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Claude API returned ${response.status}: ${data.error?.message || "unknown API error"}`);
  return (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

async function runAnalysisOnSources(sourceFiles, scope, enrich = true) {
  const report = scanSources(sourceFiles, scope);
  if (!enrich) {
    report.claude_summary = "Claude enrichment disabled for this scan.";
    return report;
  }
  // LangGraph is used when installed in the Task Manager backend image. The
  // fallback keeps the endpoint useful during local dependency installation.
  try {
    const { Annotation, StateGraph, START, END } = require("@langchain/langgraph");
    const AnalysisState = Annotation.Root({
      report: Annotation(),
      summary: Annotation()
    });
    const graph = new StateGraph(AnalysisState)
      .addNode("scan", async () => ({ report }))
      .addNode("review", async (state) => ({ summary: await claudeSummary(state.report) }))
      .addEdge(START, "scan")
      .addEdge("scan", "review")
      .addEdge("review", END)
      .compile();
    report.claude_summary = (await graph.invoke({})).summary;
  } catch (error) {
    if (error.message.includes("Cannot find module '@langchain/langgraph'")) {
      try {
        report.claude_summary = await claudeSummary(report);
      } catch (fallbackError) {
        report.claude_summary = `Claude enrichment unavailable: ${fallbackError.message}. Static analysis is still available.`;
      }
    } else {
      report.claude_summary = `Claude enrichment unavailable: ${error.message}. Static analysis is still available.`;
    }
  }
  return report;
}

async function runAnalysis(root, enrich = true) {
  return runAnalysisOnSources(
    filesUnder(root).map((filePath) => ({
      path: path.relative(root, filePath).replaceAll(path.sep, "/"),
      source: fs.readFileSync(filePath, "utf8")
    })),
    "Task Manager backend",
    enrich
  );
}

module.exports = { runAnalysis, runAnalysisOnSources };
