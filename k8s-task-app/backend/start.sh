#!/bin/sh
set -u

KEYTAB="/krb/backend.keytab"
[ -f "$KEYTAB" ] || KEYTAB="/etc/backend.keytab"

echo "Authenticating backend with Kerberos..."

# Keytab is provisioned at startup by the krb-provision initContainer.
if [ -f "$KEYTAB" ] && kinit -k -t "$KEYTAB" backend@TASKAPP.LOCAL; then
    echo "Kerberos authentication successful."
    klist
else
    echo "WARNING: Kerberos kinit failed. Database calls (GSSAPI) will not work."
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 5000
