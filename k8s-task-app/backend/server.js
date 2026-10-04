require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { execFile } = require("child_process");
const pg = require("pg");

const app = express();
const PORT = 5000;

const sessions = new Map();

// When PGNATIVE=1 we use the libpq-backed driver, which is what allows Kerberos
// (GSSAPI) authentication using the ticket obtained by kinit. Pure-JS pg only
// supports passwords/SCRAM, so it is used only for the password-auth path.
const Pool = process.env.PGNATIVE === "1" ? pg.native.Pool : pg.Pool;

// Postgres connection pool. Host/user/db come from the environment so the same
// code works for password auth and Kerberos/GSSAPI auth (where PGPASSWORD is
// simply absent and libpq uses the kinit ticket instead).
const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "taskdb",
  user: process.env.PGUSER || "app",
  password: process.env.PGPASSWORD || undefined
});

// Wait for the database to be reachable before serving traffic. Postgres (and,
// under Kerberos, the ticket) may not be ready the instant the backend starts.
async function waitForDatabase() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query("SELECT 1");
      console.log("Connected to Postgres.");
      return;
    } catch (error) {
      console.log(
        `Waiting for Postgres (attempt ${attempt}/30): ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Could not connect to Postgres after 30 attempts");
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({
    message: "Task API is running"
  });
});

// Get all tasks
app.get("/tasks", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, completed FROM tasks ORDER BY id"
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ message: "Failed to fetch tasks" });
  }
});

// Add a task
app.post("/tasks", async (req, res) => {
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({
      message: "Task title is required"
    });
  }

  try {
    const result = await pool.query(
      "INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, completed",
      [title]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error adding task:", error);
    res.status(500).json({ message: "Failed to add task" });
  }
});

// Delete a task
app.delete("/tasks/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);

    res.json({
      message: "Task deleted"
    });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ message: "Failed to delete task" });
  }
});

app.get("/auth/github", (req, res) => {
  const githubAuthUrl =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.GITHUB_CALLBACK_URL)}` +
    `&scope=repo`;

  res.redirect(githubAuthUrl);
});

app.get("/auth/kerberos", (req, res) => {
  execFile("klist", (error, stdout, stderr) => {
    if (error) {
      return res.status(401).json({
        authenticated: false,
        message: "No valid Kerberos ticket found"
      });
    }

    res.json({
      authenticated: true,
      message: "Kerberos authentication is active",
      ticket: stdout
    });
  });
});

app.get("/auth/github/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      message: "Authorization code is missing"
    });
  }

  try {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code: code
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        message: "GitHub authentication failed",
        error: data.error_description
      });
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${data.access_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    const user = await userResponse.json();

const sessionId = crypto.randomUUID();

sessions.set(sessionId, {
  accessToken: data.access_token,
  githubUser: {
    id: user.id,
    username: user.login,
    name: user.name
  }
});

res.redirect(
  `http://localhost:5173/?session_id=${encodeURIComponent(sessionId)}`
);
  } catch (error) {
    console.error("GitHub OAuth error:", error);

    res.status(500).json({
      message: "GitHub authentication failed"
    });
  }
});

app.get("/auth/me", (req, res) => {
  const sessionId = req.headers["x-session-id"];

  if (!sessionId) {
    return res.status(401).json({
      message: "Session ID is required"
    });
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(401).json({
      message: "Invalid or expired session"
    });
  }

  res.json({
    github_user: session.githubUser
  });
});

app.get("/github/repos", async (req, res) => {
  const sessionId = req.headers["x-session-id"];

  if (!sessionId) {
    return res.status(401).json({
      message: "Session ID is required"
    });
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(401).json({
      message: "Invalid or expired session"
    });
  }

  try {
    const response = await fetch(
      "https://api.github.com/user/repos?sort=updated&per_page=20",
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    const repositories = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Failed to fetch GitHub repositories",
        error: repositories.message
      });
    }

    const result = repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      html_url: repo.html_url
    }));

    res.json(result);
  } catch (error) {
    console.error("GitHub repositories error:", error);

    res.status(500).json({
      message: "Failed to fetch GitHub repositories"
    });
  }
});


// Start server (after the database is reachable)
waitForDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Startup failed:", error.message);
    process.exit(1);
  });