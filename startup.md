# Startup Guide

How to run the full Task Manager stack — **frontend + backend + PostgreSQL + Kerberos KDC** —
in a single [kind](https://kind.sigs.k8s.io/) cluster named `taskapp`.

When everything is up, open **http://localhost:30080**.

---

## Prerequisites

| Tool | Check | Install |
|------|-------|---------|
| Docker Desktop (running) | `docker info` | https://www.docker.com/products/docker-desktop |
| kubectl | `kubectl version --client` | ships with Docker Desktop |
| kind | `kind version` | `winget install Kubernetes.kind` |
| git (to clone) | `git --version` | https://git-scm.com |

> **PATH note:** right after `winget install`, `kind` is **not** on PATH in the
> current terminal. Either open a new terminal, or use the full path:
> ```powershell
> $kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"
> ```
> The steps below use `$kind`. If `kind` is already on your PATH, just replace `& $kind` with `kind`.

---

## Step-by-step: run the full application from scratch

Run these from the **repository root** (the `k8s` folder) in PowerShell.

### Step 0 — Get the code and set the kind path
```powershell
git clone https://github.com/ankmay0/k8s.git
cd k8s
$kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"
notepad .env    # set KRB_ADMIN_PASSWORD=your-strong-password
```

### Step 1 — Make sure Docker is running
```powershell
docker info --format '{{.ServerVersion}}'    # prints a version if Docker is up
# if not running:
Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
```

### Step 2 — Create the cluster
The NodePort mapping in `kind-cluster.yaml` exposes the app on `localhost:30080`.
cgroup v1 hosts (Docker Desktop on WSL2 with cgroup v1) **must** use the older node image.
```powershell
& $kind create cluster --config "k8s-task-app\k8s\kind-cluster.yaml" --image kindest/node:v1.30.0
```
`kubectl`'s context is now `kind-taskapp`.

### Step 3 — Build the images
```powershell
docker build -t task-kerberos:latest .\kerberos
docker build -t task-backend:latest  .\k8s-task-app\backend
docker build -t task-frontend:latest .\k8s-task-app\frontend
docker pull postgres:16
```

### Step 4 — Load the images into the cluster
```powershell
& $kind load docker-image task-kerberos:latest  --name taskapp
& $kind load docker-image task-backend:latest   --name taskapp
& $kind load docker-image task-frontend:latest  --name taskapp
& $kind load docker-image postgres:16           --name taskapp
```
> If the `postgres:16` load prints a `ctr: content digest ... not found` warning,
> ignore it — the Deployment uses `imagePullPolicy: IfNotPresent`, so the node
> pulls Postgres directly.

### Step 5 — Create the ConfigMaps (from the separate infra folders)
```powershell
kubectl create configmap krb5-config   --from-file=krb5.conf=kerberos\krb5.conf      --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap postgres-init --from-file=init.sql=postgres\init.sql         --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap postgres-hba  --from-file=pg_hba.conf=postgres\pg_hba.conf   --dry-run=client -o yaml | kubectl apply -f -
```

The deploy script reads `KRB_ADMIN_PASSWORD` from the local `.env` file and
creates the `kerberos-admin` Kubernetes Secret. Do not commit the value or put
it in a manifest.

### Step 6 — Apply the manifests (Kerberos first, then DB, then the app)
```powershell
kubectl apply -f kerberos\k8s\
kubectl apply -f postgres\k8s\
kubectl apply -f k8s-task-app\k8s\backend-deployment.yaml  -f k8s-task-app\k8s\backend-service.yaml
kubectl apply -f k8s-task-app\k8s\frontend-deployment.yaml -f k8s-task-app\k8s\frontend-service.yaml
```
Order matters: the backend and postgres init-containers provision their Kerberos
keytabs from the KDC at startup, so the `kerberos` pod should come up first.

### Step 7 — Wait for all 4 pods to be Running
```powershell
kubectl --context kind-taskapp get pods -w
```
Press `Ctrl+C` once `backend`, `frontend`, `kerberos`, and `postgres` all show `Running`.
(First boot takes a minute or two; a restart count of 1–2 while settling is normal.)

### Step 8 — Open the app
```powershell
Start-Process "http://localhost:30080"
```

### Step 9 — Verify Kerberos-authenticated DB access
```powershell
kubectl --context kind-taskapp exec deploy/postgres -c postgres -- `
  psql -U app -d taskdb -c "SELECT a.usename, g.gss_authenticated, g.principal FROM pg_stat_gssapi g JOIN pg_stat_activity a ON a.pid=g.pid WHERE a.usename='backend';"
```
Expected — proves the backend authenticated via Kerberos (no password):
```
 usename | gss_authenticated |       principal
---------+-------------------+-----------------------
 backend | t                 | backend@TASKAPP.LOCAL
```

### Shortcut
Steps 3–6 are wrapped in the repo's deploy script, so after Step 2 you can just run:
```powershell
.\deploy.ps1
```

### macOS
Install Docker Desktop, `kind`, and `kubectl` (Homebrew is convenient):
```bash
brew install kind kubectl
```

Start Docker Desktop, set `KRB_ADMIN_PASSWORD` in the root `.env`, then run:
```bash
chmod +x deploy.sh
kind create cluster --config k8s-task-app/k8s/kind-cluster.yaml --image kindest/node:v1.30.0
./deploy.sh
```

---

## Quick reference

### After a reboot or closing Docker Desktop
The cluster lives inside Docker — start Docker and the pods come back.
```powershell
Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
# wait ~30-60s, then:
kubectl --context kind-taskapp get pods
```

**If the app returns 502 and the backend log shows
`No Kerberos credentials available`:** a full node restart resets the KDC
(it has no persistent volume), so the keytabs need re-provisioning in order.
Restart Postgres, then the backend:
```powershell
kubectl --context kind-taskapp rollout restart deploy/postgres
kubectl --context kind-taskapp rollout status  deploy/postgres --timeout=150s
kubectl --context kind-taskapp rollout restart deploy/backend
kubectl --context kind-taskapp rollout status  deploy/backend  --timeout=150s
```
(To avoid this entirely, give the KDC a PersistentVolumeClaim so its principal
database survives restarts.)

### Health checks (any time)
```powershell
kubectl --context kind-taskapp get pods
kubectl --context kind-taskapp logs deploy/backend -c backend | Select-String "Kerberos|Postgres"
Invoke-WebRequest http://localhost:30080/api/tasks -UseBasicParsing | Select-Object -ExpandProperty Content
```

### Stop / clean up
```powershell
$kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"
& $kind delete cluster --name taskapp
```
Deleting the cluster removes the pods and the Postgres data volume. Re-run the
step-by-step to rebuild (the DB re-seeds its initial row).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Cluster create fails at "Starting control-plane" | Host is cgroup v1 → use `--image kindest/node:v1.30.0` (already in Step 2). |
| `kind` not recognized | New terminal, or use the `$kind` full path. |
| `postgres:16` load warning `content digest not found` | Harmless — node pulls it via `IfNotPresent`. |
| Backend `CrashLoopBackOff`, logs show GSSAPI realm error | Ensure `krb5-config` ConfigMap is current (Step 5) and the `kerberos` pod is Running. |
| App not reachable on :30080 | Confirm the cluster was created with `kind-cluster.yaml` (it maps the NodePort). |
