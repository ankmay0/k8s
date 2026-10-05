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

  const API_URL = "/api";

  const loginWithGitHub = () => {
  window.location.href = "http://localhost:5000/auth/github";
};

const checkKerberos = async () => {
  try {
    const response = await fetch(`${API_URL}/auth/kerberos`);
    // const response = await fetch("http://localhost:5000/auth/kerberos");

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
    const response = await fetch("http://localhost:5000/github/repos", {
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
      const response = await fetch("http://localhost:5000/auth/me", {
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
        <button onClick={loginWithGitHub} style={styles.githubButton}>
  Login with GitHub
</button>

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