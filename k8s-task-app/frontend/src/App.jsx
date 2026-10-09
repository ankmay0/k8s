import { useEffect, useState } from "react";
function App() {
const [tasks, setTasks] = useState([]);
const [title, setTitle] = useState("");
const [githubUser, setGithubUser] = useState("");
const [sessionId, setSessionId] = useState(
  localStorage.getItem("github_session_id")
);

const [repositories, setRepositories] = useState([]);
const [kerberosStatus, setKerberosStatus] = useState(false);
const [analysis, setAnalysis] = useState(null);
const [analysisLoading, setAnalysisLoading] = useState(false);
const [analysisError, setAnalysisError] = useState("");

  const API_URL = "/api";

  const loginWithGitHub = () => {
  window.location.href = "/auth/github";
};

const logout = async () => {
  try {
    if (sessionId) {
      await fetch("/auth/logout", {
        method: "POST",
        headers: {
          "x-session-id": sessionId
        }
      });
    }
  } catch (error) {
    console.error("Logout failed:", error);
  } finally {
    localStorage.removeItem("github_session_id");
    setSessionId(null);
    setGithubUser("");
    setRepositories([]);
  }
};

const checkKerberos = async () => {
  try {
    const response = await fetch("/auth/kerberos");

    if (!response.ok) {
      setKerberosStatus(false);
      return;
    }

    const data = await response.json();

    setKerberosStatus(data.authenticated);
  } catch (error) {
    console.error("Kerberos check failed:", error);
    setKerberosStatus(false);
  }
};

const fetchRepositories = async (currentSessionId) => {
  try {
    const response = await fetch("/github/repos", {
      headers: {
        "x-session-id": currentSessionId
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch repositories");
    }

    const data = await response.json();

    setRepositories(data);
  } catch (error) {
    console.error("Error fetching GitHub repositories:", error);
  }
};

  // Get tasks from backend
  const fetchTasks = async () => {
    try {
      const response = await fetch(`${API_URL}/tasks`);
      const data = await response.json();

      setTasks(data);
    } catch (error) {
      console.error("Error fetching tasks:", error);
    }
  };

  // Load tasks when page opens
useEffect(() => {
  fetchTasks();
  checkKerberos();


  const params = new URLSearchParams(window.location.search);
  const newSessionId = params.get("session_id");

  if (newSessionId) {
    localStorage.setItem("github_session_id", newSessionId);
    setSessionId(newSessionId);

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );
  }
}, []);

useEffect(() => {
  if (!sessionId) return;

  const getGitHubUser = async () => {
    try {
      const response = await fetch("/auth/me", {
        headers: {
          "x-session-id": sessionId
        }
      });

      if (!response.ok) {
        throw new Error("Session is invalid");
      }

      const data = await response.json();

      setGithubUser(data.github_user.username);
    } catch (error) {
      console.error("GitHub session error:", error);

      localStorage.removeItem("github_session_id");
      setSessionId(null);
      setGithubUser("");
    }
  };

  getGitHubUser();
  fetchRepositories(sessionId);
}, [sessionId]);

  // Add task
  const addTask = async () => {
    if (!title.trim()) return;

    try {
      await fetch(`${API_URL}/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: title
        })
      });

      setTitle("");

      fetchTasks();
    } catch (error) {
      console.error("Error adding task:", error);
    }
  };

  // Delete task
  const deleteTask = async (id) => {
    try {
      await fetch(`${API_URL}/tasks/${id}`, {
        method: "DELETE"
      });

      fetchTasks();
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  };

  const analyzeRepository = async () => {
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      const response = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrich: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Analysis failed");
      setAnalysis(data);
    } catch (error) {
      setAnalysisError(error.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const analyzeGitHubRepository = async (repo) => {
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      const response = await fetch(`${API_URL}/analyze/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-id": sessionId },
        body: JSON.stringify({ repository: repo.full_name, enrich: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "GitHub repository analysis failed");
      setAnalysis(data);
    } catch (error) {
      setAnalysisError(error.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1>Task Manager</h1>
        <p>
  Kerberos:{" "}
  <strong>
    {kerberosStatus ? "Authenticated ✓" : "Not authenticated"}
  </strong>
</p>

{githubUser && (
  <p style={styles.githubUser}>
    GitHub: <strong>@{githubUser}</strong>
  </p>
)}

{githubUser && (
  <div style={styles.repositories}>
    <h2>My GitHub Repositories</h2>

    {repositories.map((repo) => (
      <div key={repo.id} style={styles.repository}>
        <div>
          <strong>{repo.name}</strong>

          <p>
            {repo.private ? "Private repository" : "Public repository"}
          </p>
        </div>

        <button onClick={() => analyzeGitHubRepository(repo)} disabled={analysisLoading} style={styles.repoAnalyzeButton}>
          Analyze
        </button>

        <a
          href={repo.html_url}
          target="_blank"
          rel="noreferrer"
          style={styles.repoLink}
        >
          Open
        </a>
      </div>
    ))}
  </div>
)}
        {githubUser ? (
  <button onClick={logout} style={styles.logoutButton}>
    Logout
  </button>
) : (
  <button onClick={loginWithGitHub} style={styles.githubButton}>
    Login with GitHub
  </button>
)}

        <div style={styles.inputContainer}>
          <input
            type="text"
            placeholder="Enter a task..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addTask();
              }
            }}
            style={styles.input}
          />

          <button onClick={addTask} style={styles.addButton}>
            Add
          </button>
        </div>

        <div style={styles.taskList}>
          {tasks.map((task) => (
            <div key={task.id} style={styles.task}>
              <span>{task.title}</span>

              <button
                onClick={() => deleteTask(task.id)}
                style={styles.deleteButton}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        <section style={styles.analysis}>
          <div style={styles.analysisHeader}>
            <div>
              <h2>API usage analysis</h2>
              <p style={styles.muted}>Analyze the Task Manager backend or a repository accessed through GitHub.</p>
            </div>
            <button onClick={analyzeRepository} disabled={analysisLoading} style={styles.analyzeButton}>
              {analysisLoading ? "Scanning..." : "Analyze repository"}
            </button>
          </div>
          {analysisError && <p style={styles.error}>{analysisError}</p>}
          {analysis && (
            <>
              <div style={styles.stats}>
                <span><strong>{analysis.api_usage.endpoint_count}</strong> endpoints</span>
                <span><strong>{analysis.api_usage.external_hosts.length}</strong> external hosts</span>
                <span><strong>{analysis.api_usage.client_libraries.length}</strong> client libraries</span>
              </div>
              <p style={styles.summary}>{analysis.claude_summary}</p>
              <ul style={styles.compactList}>
                {analysis.api_usage.endpoints.map((endpoint) => (
                  <li key={`${endpoint.method}-${endpoint.path}-${endpoint.file}`}>
                    <code>{endpoint.method}</code> {endpoint.path} <small>{endpoint.file}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const styles = {
  repositories: {
  marginBottom: "20px"
},

repository: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px",
  marginTop: "10px",
  border: "1px solid #eee",
  borderRadius: "6px"
},

repoLink: {
  color: "#2563eb",
  textDecoration: "none",
  fontSize: "14px"
},
repoAnalyzeButton: {
  padding: "7px 10px",
  border: "none",
  borderRadius: "5px",
  backgroundColor: "#2563eb",
  color: "white",
  cursor: "pointer",
  fontSize: "13px"
},
  githubUser: {
  marginBottom: "15px",
  color: "#555",
  fontSize: "14px"
},
  githubButton: {
  width: "100%",
  padding: "12px",
  marginBottom: "20px",
  border: "none",
  borderRadius: "6px",
  backgroundColor: "#24292f",
  color: "white",
  cursor: "pointer",
  fontSize: "15px"
},
  logoutButton: {
  width: "100%",
  padding: "12px",
  marginBottom: "20px",
  border: "1px solid #d0d7de",
  borderRadius: "6px",
  backgroundColor: "white",
  color: "#24292f",
  cursor: "pointer",
  fontSize: "15px"
},
  container: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5"
  },

  card: {
    width: "500px",
    padding: "30px",
    backgroundColor: "white",
    borderRadius: "12px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.1)"
  },

  inputContainer: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px"
  },

  input: {
    flex: 1,
    padding: "12px",
    border: "1px solid #ddd",
    borderRadius: "6px",
    fontSize: "16px"
  },

  addButton: {
    padding: "12px 20px",
    border: "none",
    borderRadius: "6px",
    backgroundColor: "#2563eb",
    color: "white",
    cursor: "pointer"
  },

  taskList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px"
  },

  task: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px",
    border: "1px solid #eee",
    borderRadius: "6px"
  },

  analysis: { marginTop: "28px", paddingTop: "22px", borderTop: "1px solid #eee" },
  analysisHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" },
  muted: { color: "#667085", fontSize: "13px", marginTop: "5px", lineHeight: 1.4 },
  analyzeButton: { padding: "9px 12px", border: "none", borderRadius: "6px", backgroundColor: "#111827", color: "white", cursor: "pointer", whiteSpace: "nowrap" },
  error: { color: "#b42318", fontSize: "13px", marginTop: "12px" },
  stats: { display: "flex", gap: "14px", margin: "16px 0", fontSize: "13px", color: "#475467" },
  summary: { whiteSpace: "pre-wrap", background: "#f8fafc", borderRadius: "6px", padding: "12px", fontSize: "13px", lineHeight: 1.5 },
  compactList: { marginTop: "12px", paddingLeft: "18px", fontSize: "13px", lineHeight: 1.8 },

  deleteButton: {
    padding: "6px 10px",
    border: "none",
    borderRadius: "5px",
    backgroundColor: "#dc2626",
    color: "white",
    cursor: "pointer"
  }
};

export default App;
