import os
import re
from pathlib import Path
from typing import Any

import httpx

TEXT_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".json", ".yaml", ".yml", ".md", ".py"}
EXCLUDED = {"node_modules", ".git", "dist", "build", ".venv", "__pycache__"}
URL_RE = re.compile(r"https?://[^\s\"'`)>]+")
CLIENT_RE = re.compile(r"\b(fetch|axios|pg|express|grpc|GraphQL|Anthropic|OpenAI|boto3|requests|httpx)\b", re.I)
ROUTE_RE = re.compile(r"(?:app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*[\"'`]([^\"'`]+)", re.I)
FASTAPI_ROUTE_RE = re.compile(r"@(?:app|router)\.(get|post|put|patch|delete|options|head)\(\s*[\"']([^\"']+)", re.I)
AUTH_RE = re.compile(r"authorization|bearer|oauth|api[_-]?key|jwt|session|kerberos|gssapi", re.I)


def _source_files(root: Path) -> list[tuple[str, str]]:
    files = []
    if not root.exists():
        return files
    for path in root.rglob("*"):
        if not path.is_file() or any(part in EXCLUDED for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        try:
            files.append((path.relative_to(root).as_posix(), path.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError):
            continue
    return files


def scan_sources(source_files: list[tuple[str, str]], scope: str) -> dict[str, Any]:
    endpoint_usage = []
    external_hosts: dict[str, int] = {}
    client_libraries: dict[str, int] = {}
    files = []
    total_lines = 0
    for relative_file, source in source_files:
        urls = sorted(set(URL_RE.findall(source)))
        routes = []
        seen_routes = set()
        for match in list(ROUTE_RE.finditer(source)) + list(FASTAPI_ROUTE_RE.finditer(source)):
            route = {"method": match.group(1).upper(), "path": match.group(2), "file": relative_file}
            route_key = (route["method"], route["path"], route["file"])
            if route_key in seen_routes:
                continue
            seen_routes.add(route_key)
            routes.append(route)
            endpoint_usage.append(route)
        for url in urls:
            host = re.sub(r"^https?://", "", url).split("/", 1)[0].split(":", 1)[0]
            external_hosts[host] = external_hosts.get(host, 0) + 1
        for match in CLIENT_RE.finditer(source):
            name = match.group(1).lower()
            client_libraries[name] = client_libraries.get(name, 0) + 1
        lines = source.count("\n") + 1
        total_lines += lines
        if urls or routes or CLIENT_RE.search(source):
            files.append({"file": relative_file, "lines": lines, "urls": urls, "routes": routes})
    return {
        "scope": scope,
        "scanned_files": len(files),
        "total_lines": total_lines,
        "api_usage": {
            "endpoint_count": len(endpoint_usage),
            "endpoints": endpoint_usage,
            "external_hosts": [{"host": host, "references": count} for host, count in sorted(external_hosts.items(), key=lambda item: item[1], reverse=True)],
            "client_libraries": [{"library": library, "references": count} for library, count in sorted(client_libraries.items(), key=lambda item: item[1], reverse=True)],
            "files_with_auth_signals": [path for path, source in source_files if AUTH_RE.search(source)],
        },
        "files": files,
    }


async def _claude_summary(report: dict[str, Any]) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return "Claude enrichment skipped: ANTHROPIC_API_KEY is not configured."
    payload = {
        "model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929"),
        "max_tokens": 700,
        "temperature": 0,
        "messages": [{"role": "user", "content": "Review this Task Manager API report. Return exactly three short sections: Key findings, Risks/gaps, Next actions.\n\n" + str(report)}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post("https://api.anthropic.com/v1/messages", headers={"content-type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"}, json=payload)
    data = response.json()
    if response.is_error:
        raise RuntimeError(f"Claude API returned {response.status_code}: {data.get('error', {}).get('message', 'unknown API error')}")
    return "\n".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")


async def analyze_sources(source_files: list[tuple[str, str]], scope: str, enrich: bool = True) -> dict[str, Any]:
    report = scan_sources(source_files, scope)
    if not enrich:
        report["claude_summary"] = "Claude enrichment disabled for this scan."
        return report
    try:
        report["claude_summary"] = await _claude_summary(report)
    except Exception as exc:
        report["claude_summary"] = f"Claude enrichment unavailable: {exc}. Static analysis is still available."
    return report


async def analyze_directory(root: str, enrich: bool = True) -> dict[str, Any]:
    return await analyze_sources(_source_files(Path(root)), "Task Manager backend", enrich)
