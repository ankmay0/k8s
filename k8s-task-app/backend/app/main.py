import base64
import os
import re
import secrets
import subprocess
import time
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlencode

import httpx
import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from .repository_analyzer import analyze_directory, analyze_sources

sessions: dict[str, dict[str, Any]] = {}


class TaskCreate(BaseModel):
    title: str


class AnalysisRequest(BaseModel):
    enrich: bool = True


class GithubAnalysisRequest(BaseModel):
    repository: str
    enrich: bool = True


def db_connect() -> psycopg.Connection:
    return psycopg.connect(
        host=os.getenv("PGHOST", "postgres"), port=int(os.getenv("PGPORT", "5432")),
        dbname=os.getenv("PGDATABASE", "taskdb"), user=os.getenv("PGUSER", "app"),
        password=os.getenv("PGPASSWORD") or None, connect_timeout=5, row_factory=dict_row,
    )
    
def wait_for_database() -> None:
    last_error = None
    for attempt in range(1, 31):
        try:
            with db_connect() as connection:
                connection.execute("SELECT 1")
            print("Connected to Postgres.", flush=True)
            return
        except Exception as exc:
            last_error = exc
            print(f"Waiting for Postgres (attempt {attempt}/30): {exc}", flush=True)
            time.sleep(2)
    raise RuntimeError(f"Could not connect to Postgres after 30 attempts: {last_error}")

@asynccontextmanager
async def lifespan(_: FastAPI):
    wait_for_database()
    yield

app = FastAPI(title="Task Manager API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def error(message: str, status_code: int = 500, **extra: Any):
    return JSONResponse(status_code=status_code, content={"message": message, **extra})

@app.get("/")
def root():
    return {"message": "Task API is running"}

@app.get("/tasks")
def get_tasks():
    try:
        with db_connect() as connection:
            return [dict(row) for row in connection.execute("SELECT id, title, completed FROM tasks ORDER BY id").fetchall()]
    except Exception:
        return error("Failed to fetch tasks")

@app.post("/tasks", status_code=201)
def add_task(task: TaskCreate):
    if not task.title.strip():
        return error("Task title is required", 400)
    try:
        with db_connect() as connection:
            row = connection.execute("INSERT INTO tasks (title) VALUES (%s) RETURNING id, title, completed", (task.title,)).fetchone()
            connection.commit()
            return dict(row)
    except Exception:
        return error("Failed to add task")

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    try:
        with db_connect() as connection:
            connection.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
            connection.commit()
        return {"message": "Task deleted"}
    except Exception:
        return error("Failed to delete task")

@app.get("/auth/kerberos")
def kerberos_status():
    try:
        result = subprocess.run(["klist"], capture_output=True, text=True, check=True)
        return {"authenticated": True, "message": "Kerberos authentication is active", "ticket": result.stdout}
    except (OSError, subprocess.CalledProcessError):
        return error("No valid Kerberos ticket found", 401, authenticated=False)

@app.get("/auth/github")
def github_login():
    params = {"client_id": os.getenv("GITHUB_CLIENT_ID", ""), "redirect_uri": os.getenv("GITHUB_CALLBACK_URL", ""), "scope": "repo"}
    return RedirectResponse("https://github.com/login/oauth/authorize?" + urlencode(params))

def github_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

def session_for(session_id: str | None) -> dict[str, Any]:
    if not session_id or session_id not in sessions:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return sessions[session_id]

@app.get("/auth/github/callback")
async def github_callback(code: str | None = None):
    if not code:
        return error("Authorization code is missing", 400)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            token_response = await client.post("https://github.com/login/oauth/access_token", headers={"Accept": "application/json"}, json={"client_id": os.getenv("GITHUB_CLIENT_ID"), "client_secret": os.getenv("GITHUB_CLIENT_SECRET"), "code": code})
            token_data = token_response.json()
            if token_data.get("error"):
                return error("GitHub authentication failed", 400, error=token_data.get("error_description"))
            user_response = await client.get("https://api.github.com/user", headers=github_headers(token_data["access_token"]))
            user = user_response.json()
        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = {"access_token": token_data["access_token"], "github_user": {"id": user.get("id"), "username": user.get("login"), "name": user.get("name")}}
        return RedirectResponse("/?session_id=" + session_id)
    except Exception:
        return error("GitHub authentication failed")

@app.get("/auth/me")
def auth_me(x_session_id: str | None = Header(default=None)):
    return {"github_user": session_for(x_session_id)["github_user"]}

@app.post("/auth/logout")
def logout(x_session_id: str | None = Header(default=None)):
    if x_session_id:
        sessions.pop(x_session_id, None)
    return {"message": "Logged out"}

@app.get("/github/repos")
async def github_repos(x_session_id: str | None = Header(default=None)):
    session = session_for(x_session_id)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get("https://api.github.com/user/repos?sort=updated&per_page=20", headers=github_headers(session["access_token"]))
        data = response.json()
        if response.is_error:
            return error("Failed to fetch GitHub repositories", response.status_code, error=data.get("message"))
        return [{"id": repo["id"], "name": repo["name"], "full_name": repo["full_name"], "private": repo["private"], "html_url": repo["html_url"], "default_branch": repo.get("default_branch")} for repo in data]
    except Exception:
        return error("Failed to fetch GitHub repositories")


@app.post("/analyze")
async def analyze(request: AnalysisRequest):
    try:
        root = os.getenv("ANALYZER_ROOT") or os.path.dirname(os.path.dirname(__file__))
        return await analyze_directory(root, request.enrich)
    except Exception as exc:
        return error("Repository analysis failed", error=str(exc))


@app.post("/analyze/github")
async def analyze_github(request: GithubAnalysisRequest, x_session_id: str | None = Header(default=None)):
    session = session_for(x_session_id)
    if not re.fullmatch(r"[^/\s]+/[^/\s]+", request.repository):
        return error("repository must be in owner/name format", 400)
    try:
        headers = github_headers(session["access_token"])
        async with httpx.AsyncClient(timeout=60) as client:
            repo_response = await client.get(f"https://api.github.com/repos/{request.repository}", headers=headers)
            repo_data = repo_response.json()
            if repo_response.is_error:
                return error("Unable to access repository", repo_response.status_code, error=repo_data.get("message"))
            branch = repo_data["default_branch"]
            tree_response = await client.get(f"https://api.github.com/repos/{request.repository}/git/trees/{branch}?recursive=1", headers=headers)
            tree_data = tree_response.json()
            if tree_response.is_error:
                return error("Unable to read repository tree", tree_response.status_code, error=tree_data.get("message"))
            supported = re.compile(r"\.(js|jsx|ts|tsx|json|yaml|yml|md|py)$", re.I)
            blobs = [item for item in tree_data.get("tree", []) if item.get("type") == "blob" and supported.search(item.get("path", "")) and item.get("size", 0) <= 250000][:120]
            source_files = []
            for blob in blobs:
                blob_response = await client.get(blob["url"], headers=headers)
                if blob_response.is_success:
                    blob_data = blob_response.json()
                    if blob_data.get("encoding") == "base64":
                        source_files.append((blob["path"], base64.b64decode(blob_data["content"]).decode("utf-8", errors="replace")))
        report = await analyze_sources(source_files, f"GitHub repository {request.repository}", request.enrich)
        report.update({"repository": request.repository, "default_branch": branch, "github_url": repo_data.get("html_url")})
        return report
    except Exception as exc:
        return error("GitHub repository analysis failed", error=str(exc)