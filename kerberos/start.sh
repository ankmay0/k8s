#!/bin/bash

set -e

REALM="TASKAPP.LOCAL"

if [ -z "${KRB_ADMIN_PASSWORD:-}" ]; then
    echo "KRB_ADMIN_PASSWORD must be set" >&2
    exit 1
fi

echo "Initializing Kerberos realm..."

if [ ! -f /var/lib/krb5kdc/principal ]; then
    kdb5_util create -s -P "$KRB_ADMIN_PASSWORD"
fi

echo "Creating admin principal..."

kadmin.local -q "addprinc -pw $KRB_ADMIN_PASSWORD admin/admin"

echo "Starting Kerberos KDC..."

krb5kdc

echo "Starting Kerberos administration server..."

kadmind -nofork
