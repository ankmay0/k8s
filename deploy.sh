#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/k8s-task-app"
CONTEXT="kind-taskapp"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

for command_name in docker kind kubectl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

if [[ -z "${KRB_ADMIN_PASSWORD:-}" ]]; then
  echo "Set KRB_ADMIN_PASSWORD in $ENV_FILE before deploying." >&2
  exit 1
fi

docker info >/dev/null

if ! kind get clusters | grep -qx "taskapp"; then
  echo "The kind cluster 'taskapp' does not exist." >&2
  echo "Create it with:" >&2
  echo "kind create cluster --config k8s-task-app/k8s/kind-cluster.yaml --image kindest/node:v1.30.0" >&2
  exit 1
fi

echo "== Build images =="
docker build -t task-kerberos:latest "$ROOT_DIR/kerberos"
docker build -t task-backend:latest "$APP_DIR/backend"
docker build -t task-frontend:latest "$APP_DIR/frontend"
docker pull postgres:16

echo "== Load images into the cluster =="
kind load docker-image task-kerberos:latest --name taskapp
kind load docker-image task-backend:latest --name taskapp
kind load docker-image task-frontend:latest --name taskapp
kind load docker-image postgres:16 --name taskapp

echo "== Create ConfigMaps and Secret =="
kubectl --context "$CONTEXT" create configmap krb5-config \
  --from-file="krb5.conf=$ROOT_DIR/kerberos/krb5.conf" \
  --dry-run=client -o yaml | kubectl --context "$CONTEXT" apply -f -
kubectl --context "$CONTEXT" create configmap postgres-init \
  --from-file="init.sql=$ROOT_DIR/postgres/init.sql" \
  --dry-run=client -o yaml | kubectl --context "$CONTEXT" apply -f -
kubectl --context "$CONTEXT" create configmap postgres-hba \
  --from-file="pg_hba.conf=$ROOT_DIR/postgres/pg_hba.conf" \
  --dry-run=client -o yaml | kubectl --context "$CONTEXT" apply -f -
kubectl --context "$CONTEXT" create secret generic kerberos-admin \
  --from-literal="password=$KRB_ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl --context "$CONTEXT" apply -f -
if [[ -f "$APP_DIR/backend/.env" ]]; then
  kubectl --context "$CONTEXT" create secret generic github-oauth \
    --from-env-file="$APP_DIR/backend/.env" \
    --dry-run=client -o yaml | kubectl --context "$CONTEXT" apply -f -
fi

echo "== Apply manifests =="
kubectl --context "$CONTEXT" apply -f "$ROOT_DIR/kerberos/k8s/"
kubectl --context "$CONTEXT" apply -f "$ROOT_DIR/postgres/k8s/"
kubectl --context "$CONTEXT" apply -f "$APP_DIR/k8s/backend-deployment.yaml" -f "$APP_DIR/k8s/backend-service.yaml"
kubectl --context "$CONTEXT" apply -f "$APP_DIR/k8s/frontend-deployment.yaml" -f "$APP_DIR/k8s/frontend-service.yaml"

echo "== Pods =="
kubectl --context "$CONTEXT" get pods
echo "Open http://localhost:30080"
