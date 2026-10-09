# Task Manager on Kubernetes (with Kerberos-authenticated Postgres)

A small full-stack Task Manager that runs in a single [kind](https://kind.sigs.k8s.io/)
cluster, demonstrating service-to-service **Kerberos/GSSAPI** authentication to a
database that lives entirely outside the application.

## Layout

```
k8s/
├── k8s-task-app/     # the application
│   ├── frontend/     # React + Vite, served by nginx
│   ├── backend/      # Node/Express API (tasks stored in Postgres)
│   └── k8s/          # frontend + backend manifests, kind-cluster.yaml
├── kerberos/         # MIT Kerberos KDC (separate infra) + its k8s/ manifests
├── postgres/         # PostgreSQL config/init (separate infra) + its k8s/ manifests
└── deploy.ps1        # build + load images, apply everything into the cluster
```

## Architecture

```
Browser ─:30080─▶ frontend (nginx) ─/api─▶ backend (Express)
                                              │  kinit → ticket (backend@TASKAPP.LOCAL)
                                              ▼  GSSAPI, no password
                                          postgres  ◀─ principal postgres/postgres@TASKAPP.LOCAL
   kerberos (KDC) ◀─ init-containers provision keytabs at startup
```

- The backend authenticates to Postgres with a Kerberos ticket (no DB password).
  Postgres `pg_hba.conf` requires `gss` for all TCP connections.
- Keytabs are provisioned at runtime by each pod's init-container (nothing secret
  is committed).

## Run

Prereqs: Docker Desktop, `kind`, `kubectl`.

```powershell
# create the cluster (cgroup v1 hosts need the older node image)
kind create cluster --config k8s-task-app/k8s/kind-cluster.yaml --image kindest/node:v1.30.0

# Put your local Kerberos admin password in .env, then deploy.
# KRB_ADMIN_PASSWORD=your-strong-password
./deploy.ps1
```
# 1. create the cluster (helm)
kind create cluster --config k8s-task-app/k8s/kind-cluster.yaml --image kindest/node:v1.30.0

# 2. build images, load them, and install the chart
.\taskapp\deploy-helm.ps1

On macOS or Linux, create the cluster with `kind`, put `KRB_ADMIN_PASSWORD` in
`.env`, and run `chmod +x deploy.sh && ./deploy.sh`.

For GitHub login, copy `k8s-task-app/backend/.env.example` to
`k8s-task-app/backend/.env`, fill in the GitHub OAuth values, and rerun the
deployment script.

Then open http://localhost:30080.

### Verify Kerberos DB auth

```powershell
kubectl --context kind-taskapp exec deploy/postgres -c postgres -- `
  psql -U app -d taskdb -c "SELECT a.usename, g.gss_authenticated, g.principal FROM pg_stat_gssapi g JOIN pg_stat_activity a ON a.pid=g.pid WHERE a.usename='backend';"
```

## Configuration

Copy `k8s-task-app/backend/.env.example` to `.env` and fill in GitHub OAuth
credentials (used only for the optional "Login with GitHub" feature). Real
secrets and keytabs are gitignored and must never be committed.
