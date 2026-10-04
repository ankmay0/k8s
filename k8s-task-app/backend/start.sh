#!/bin/sh

echo "Authenticating backend with Kerberos..."

# Keytab is provisioned at startup by the krb-provision initContainer.
if kinit -k -t /krb/backend.keytab backend@TASKAPP.LOCAL; then
    echo "Kerberos authentication successful."
    klist
else
    echo "WARNING: Kerberos kinit failed. Database calls (GSSAPI) will not work."
fi

echo "Starting Node.js backend..."

exec node server.js