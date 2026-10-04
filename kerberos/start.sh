#!/bin/bash

set -e

REALM="TASKAPP.LOCAL"
PASSWORD="admin123"

echo "Initializing Kerberos realm..."

if [ ! -f /var/lib/krb5kdc/principal ]; then
    kdb5_util create -s -P "$PASSWORD"
fi

echo "Creating admin principal..."

kadmin.local -q "addprinc -pw $PASSWORD admin/admin"

echo "Starting Kerberos KDC..."

krb5kdc

echo "Starting Kerberos administration server..."

kadmind -nofork