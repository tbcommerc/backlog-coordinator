-- DBA ONLY. Never run from the application or its deployment entrypoint.
-- The database, schema and login role already exist under bank procedures.
-- Example: psql -v app_role=dmb_runtime -f runtime-role-grants.sql ...
-- Review inherited role/PUBLIC privileges too; the app must not own objects.
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.alembic_version FROM :"app_role";
GRANT SELECT ON public.alembic_version TO :"app_role";
REVOKE CREATE ON SCHEMA public FROM :"app_role";
-- No passwords, CREATE ROLE, CREATE DATABASE or automatic changes to PUBLIC.
