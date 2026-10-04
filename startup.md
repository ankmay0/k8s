# Startup Guide

How to start the Task Manager stack (frontend + backend + Postgres + Kerberos),
which all run in a single [kind](https://kind.sigs.k8s.io/) cluster named `taskapp`.

Once running, open **http://localhost:30080**.

> **Note:** `kind` is not on PATH in a fresh terminal. Either restart your
> terminal, or use the full path shown below. `kubectl` and `docker` (from
> Docker Desktop) work directly.
>
> ```powershell
> $kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"
> ```

---

## A) After a reboot or closing Docker Desktop (most common)

The cluster lives inside Docker, so you only need to start Docker — the pods
come back automatically.

```powershell
# 1. Start Docker Desktop
Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"

# 2. Wait ~30-60s for the engine, then confirm the cluster + pods recovered:
kubectl --context kind-taskapp get pods
```

When all 4 pods show `Running`, open http://localhost:30080.
(A restart count of 1-2 while settling is normal.)

---

## B) If the cluster is gone (e.g. after `kind delete cluster`)

Recreate the cluster, then deploy everything with the script.

```powershell
$kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"

# cgroup v1 hosts (Docker Desktop on WSL2 w/ cgroup v1) need the older node image
& $kind create cluster --config "k8s-task-app\k8s\kind-cluster.yaml" --image kindest/node:v1.30.0

# build images, load them, create ConfigMaps, apply all manifests
.\deploy.ps1
```

`deploy.ps1` (at the repo root) handles: building `task-kerberos`, `task-backend`,
`task-frontend`; pulling `postgres:16`; loading all images into the cluster;
creating the `krb5-config`, `postgres-init`, `postgres-hba` ConfigMaps from the
separate `kerberos/` and `postgres/` folders; and applying the kerberos, postgres,
and app manifests in order.

---

## C) Health checks (any time)

```powershell
# All pods Running?
kubectl --context kind-taskapp get pods

# Backend got its Kerberos ticket and connected to the DB?
kubectl --context kind-taskapp logs deploy/backend -c backend | Select-String "Kerberos|Postgres"

# Proof the DB auth is via Kerberos (no password):
kubectl --context kind-taskapp exec deploy/postgres -c postgres -- `
  psql -U app -d taskdb -c "SELECT a.usename, g.gss_authenticated, g.principal FROM pg_stat_gssapi g JOIN pg_stat_activity a ON a.pid=g.pid WHERE a.usename='backend';"

# App reachable?
Invoke-WebRequest http://localhost:30080/api/tasks -UseBasicParsing | Select-Object -ExpandProperty Content
```

Expected GSSAPI proof:

```
 usename | gss_authenticated |       principal
---------+-------------------+-----------------------
 backend | t                 | backend@TASKAPP.LOCAL
```

---

## Stop / clean up

```powershell
$kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"

# Stop everything but keep the cluster (just quit Docker Desktop), or delete it:
& $kind delete cluster --name taskapp
```

Deleting the cluster removes the pods and the Postgres data volume. Re-running
section **B** rebuilds everything from scratch (the DB re-seeds its initial row).
