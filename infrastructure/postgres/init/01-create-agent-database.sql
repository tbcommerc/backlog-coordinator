SELECT 'CREATE DATABASE agent_sessions OWNER dmb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agent_sessions')\gexec
