# Deploy the Task Manager with Helm (replaces deploy.ps1's kubectl apply steps).
# Run from the k8s\ repo root, after creating the kind cluster:
#   kind create cluster --config k8s-task-app\k8s\kind-cluster.yaml --image kindest/node:v1.30.0

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$app  = Join-Path $root "k8s-task-app"
$ctx  = "kind-taskapp"
$kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"

Write-Host "== Build images ==" -ForegroundColor Cyan
docker build -t task-kerberos:latest "$root\kerberos"
docker build -t task-backend:latest  "$app\backend"
docker build -t task-frontend:latest "$app\frontend"
docker pull postgres:16

Write-Host "== Load images into the cluster ==" -ForegroundColor Cyan
foreach ($img in "task-kerberos:latest","task-backend:latest","task-frontend:latest","postgres:16") {
    & $kind load docker-image $img --name taskapp
}

Write-Host "== Helm install/upgrade ==" -ForegroundColor Cyan
helm upgrade --install taskapp "$root\taskapp" --kube-context $ctx

kubectl --context $ctx get pods
Write-Host "Open http://localhost:30080" -ForegroundColor Green
