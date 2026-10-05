-- Schema + seed for the Task Manager database.
-- Runs automatically on first boot via /docker-entrypoint-initdb.d.

CREATE TABLE IF NOT EXISTS tasks (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title      TEXT NOT NULL,
    completed  BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tasks (title, completed)
SELECT 'Learn Kubernetes', false
WHERE NOT EXISTS (SELECT 1 FROM tasks);

-- DB role the backend authenticates as via Kerberos (GSSAPI). The Kerberos
-- principal backend@TASKAPP.LOCAL maps to this role (include_realm=0 in pg_hba).
-- The role has no password: it can only be used through a valid Kerberos ticket.
CREATE ROLE backend WITH LOGIN;

GRANT CONNECT ON DATABASE taskdb TO backend;
GRANT USAGE ON SCHEMA public TO backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO backend;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO backend;
