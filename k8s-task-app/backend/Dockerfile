FROM node:22-bookworm-slim

WORKDIR /app

# krb5-user: kinit/klist for the Kerberos ticket.
# build-essential + libpq-dev + libkrb5-dev: needed to compile pg-native
# (the libpq-backed driver), which is what lets Node authenticate to Postgres
# with a Kerberos ticket (pure-JS pg cannot do GSSAPI).
RUN apt-get update && \
    apt-get install -y krb5-user build-essential libpq-dev libkrb5-dev python3 pkg-config && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5000

COPY start.sh /start.sh

RUN sed -i 's/\r$//' /start.sh && chmod +x /start.sh

CMD ["/start.sh"]