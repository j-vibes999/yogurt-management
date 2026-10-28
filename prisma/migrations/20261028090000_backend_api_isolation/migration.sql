-- Backend-only application objects must not be exposed through client API roles.
-- Keep owners' SQL access; do not FORCE RLS or add permissive client policies.
-- The explicit inventory excludes Supabase-managed schemas and unrelated public tables.
DO $isolate$
DECLARE
  app_names text[] := ARRAY[
    '_prisma_migrations', 'users', 'user_sessions', 'raw_materials', 'purchase_orders',
    'purchase_order_items', 'finished_products', 'raw_material_adjustments', 'recipes',
    'recipe_items', 'production_batches', 'stores', 'fridges', 'fridge_inventory',
    'restock_visits', 'restock_visit_items', 'settlements', 'refill_requests',
    'refill_request_items', 'expense_categories', 'expenses', 'audit_logs',
    'finished_goods_adjustments', 'daily_closings', 'operation_receipts', 'fridge_stock_lots'
  ];
  app_oids oid[];
  backend_owners oid[];
  relation record;
  routine record;
  owner_role record;
  api_role text;
  grantee text;
  columns_sql text;
  backend_bypasses_rls boolean;
BEGIN
  SELECT coalesce(array_agg(c.oid), ARRAY[]::oid[]), coalesce(array_agg(DISTINCT c.relowner), ARRAY[]::oid[])
    INTO app_oids, backend_owners
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(app_names) AND c.relkind IN ('r', 'p');
  SELECT rolsuper OR rolbypassrls INTO backend_bypasses_rls FROM pg_roles WHERE rolname = current_user;

  FOR relation IN SELECT c.oid, c.relname, c.relowner, c.relforcerowsecurity FROM pg_class c WHERE c.oid = ANY(app_oids)
  LOOP
    -- A copied database or migration must use its backend owner/bypass role, never a client role.
    IF NOT backend_bypasses_rls AND (relation.relforcerowsecurity OR NOT pg_has_role(current_user, relation.relowner, 'USAGE')) THEN
      RAISE EXCEPTION 'Backend role cannot bypass row security on public.%', relation.relname;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation.relname);
    SELECT string_agg(format('%I', attname), ', ') INTO columns_sql
      FROM pg_attribute WHERE attrelid = relation.oid AND attnum > 0 AND NOT attisdropped;
    FOREACH api_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated']
    LOOP
      IF api_role <> 'PUBLIC' AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN CONTINUE; END IF;
      grantee := CASE WHEN api_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(api_role) END;
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %s', relation.relname, grantee);
      -- Table REVOKE alone leaves earlier column grants in place.
      IF columns_sql IS NOT NULL THEN
        EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM %s', columns_sql, relation.relname, grantee);
      END IF;
      IF api_role <> 'PUBLIC' AND (has_table_privilege(api_role, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(api_role, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
        RAISE EXCEPTION 'API role % still inherits privileges on public.%', api_role, relation.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- Serial/identity sequences owned by an application table are part of that table's API surface.
  FOR relation IN
    SELECT DISTINCT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = ANY(app_oids) AND d.deptype IN ('a', 'i')
  LOOP
    FOREACH api_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated']
    LOOP
      IF api_role <> 'PUBLIC' AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN CONTINUE; END IF;
      grantee := CASE WHEN api_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(api_role) END;
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM %s', relation.relname, grantee);
    END LOOP;
  END LOOP;

  -- Only backend-owned public routines; never extension members or Supabase-managed owners.
  FOR routine IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
      AND (p.proowner = ANY(backend_owners) OR p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user))
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    FOREACH api_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated']
    LOOP
      IF api_role <> 'PUBLIC' AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN CONTINUE; END IF;
      grantee := CASE WHEN api_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(api_role) END;
      EXECUTE format('REVOKE ALL PRIVILEGES ON ROUTINE %s FROM %s', routine.signature, grantee);
    END LOOP;
  END LOOP;

  -- Supabase grants public objects created by postgres automatically. Local installations
  -- may have no postgres/API roles; harden the current migration owner in either case.
  FOR owner_role IN SELECT oid, rolname FROM pg_roles WHERE rolname IN ('postgres', current_user)
  LOOP
    IF NOT pg_has_role(current_user, owner_role.oid, 'MEMBER') THEN
      -- An ordinary local app owner need not administer its cluster's postgres role.
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Backend role cannot change default privileges for %', owner_role.rolname;
    END IF;
    FOREACH api_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated']
    LOOP
      IF api_role <> 'PUBLIC' AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN CONTINUE; END IF;
      grantee := CASE WHEN api_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(api_role) END;
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %s', owner_role.rolname, grantee);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %s', owner_role.rolname, grantee);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %s', owner_role.rolname, grantee);
    END LOOP;
    -- PostgreSQL's built-in PUBLIC EXECUTE is global; a schema-only REVOKE cannot remove it.
    -- Existing managed/extension routines are unchanged. Future routines need explicit grants.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', owner_role.rolname);
  END LOOP;
END
$isolate$;
