# Deploy the Task Manager stack into the shared "taskapp" kind cluster.
#
# Layout (kerberos + postgres are separate from the app project):
#   k8s\
#   ├── k8s-task-app\   app: frontend + backend (+ their k8s manifests)
#   ├── kerberos\       KDC: build files + k8s\ manifests
#   └── postgres\       DB:  config + k8s\ manifests
#
# Run from the k8s\ directory:  .\deploy.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$app  = Join-Path $root "k8s-task-app"
$ctx  = "kind-taskapp"
$kind = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Kubernetes.kind_Microsoft.Winget.Source_8wekyb3d8bbwe\kind.exe"

# Load the local .env file without executing its contents.
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        $trimmed = $line.Trim()
        if ($trimmed -and -not $trimmed.StartsWith('#') -and $trimmed.Contains('=')) {
            $parts = $trimmed.Split('=', 2)
            $name = $parts[0].Trim()
            $value = $parts[1].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            if ($name -eq 'KRB_ADMIN_PASSWORD') {
                $env:KRB_ADMIN_PASSWORD = $value
            }
        }
    }
}

Write-Host "== Build images ==" -ForegroundColor Cyan
docker build -t task-kerberos:latest "$root\kerberos"
docker build -t task-backend:latest  "$app\backend"
docker build -t task-frontend:latest "$app\frontend"
docker pull postgres:16

Write-Host "== Load images into the cluster ==" -ForegroundColor Cyan
foreach ($img in "task-kerberos:latest","task-backend:latest","task-frontend:latest","postgres:16") {
    & $kind load docker-image $img --name taskapp
}

Write-Host "== ConfigMaps / Secrets (sourced from the separate infra folders) ==" -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($env:KRB_ADMIN_PASSWORD)) {
    throw "Set KRB_ADMIN_PASSWORD in .env before deploying."
}

kubectl --context $ctx create configmap krb5-config   --from-file=krb5.conf=$root\kerberos\krb5.conf     --dry-run=client -o yaml | kubectl --context $ctx apply -f -
kubectl --context $ctx create configmap postgres-init --from-file=init.sql=$root\postgres\init.sql        --dry-run=client -o yaml | kubectl --context $ctx apply -f -
kubectl --context $ctx create configmap postgres-hba  --from-file=pg_hba.conf=$root\postgres\pg_hba.conf  --dry-run=client -o yaml | kubectl --context $ctx apply -f -
kubectl --context $ctx create secret generic kerberos-admin --from-literal=password=$env:KRB_ADMIN_PASSWORD --dry-run=client -o yaml | kubectl --context $ctx apply -f -
if (Test-Path "$app\backend\.env") {
    kubectl --context $ctx create secret generic github-oauth --from-env-file="$app\backend\.env" --dry-run=client -o yaml | kubectl --context $ctx apply -f -
}

Write-Host "== Apply manifests ==" -ForegroundColor Cyan
# Infra first (separate folders), then the app.
kubectl --context $ctx apply -f $root\kerberos\k8s\
kubectl --context $ctx apply -f $root\postgres\k8s\
kubectl --context $ctx apply -f $app\k8s\backend-deployment.yaml -f $app\k8s\backend-service.yaml
kubectl --context $ctx apply -f $app\k8s\frontend-deployment.yaml -f $app\k8s\frontend-service.yaml

Write-Host "== Pods ==" -ForegroundColor Cyan
kubectl --context $ctx get pods
Write-Host "Open http://localhost:30080" -ForegroundColor Green
