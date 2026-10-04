FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y krb5-kdc krb5-admin-server && \
    rm -rf /var/lib/apt/lists/*

COPY krb5.conf /etc/krb5.conf
COPY kadm5.acl /etc/krb5kdc/kadm5.acl
COPY start.sh /start.sh

RUN chmod +x /start.sh

EXPOSE 88
EXPOSE 749

CMD ["/start.sh"]