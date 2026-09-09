SELECT 'CREATE DATABASE prioritiser OWNER dmb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'prioritiser')\gexec
