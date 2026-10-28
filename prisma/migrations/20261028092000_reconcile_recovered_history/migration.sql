-- Two migration sources were recreated from the live schema after folder loss
-- (repository commit ec21a92768e50cc9b2d004a9a75195f3a8cf8fb7).
-- Reconcile only the two recorded original checksums, after checking the objects
-- those migrations own. Never accept an unknown checksum or reset application data.
DO $reconcile$
DECLARE
  entry record;
  recorded text;
  object_count integer;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('20261013140000_auth_sessions_lockout', '0c4d94a2d96ff9b6663f19fcc103d1c0887ddd5a917403afedeae2f517350a86', '1a027ef1a528ffa75cca6252da44b321ca9bec2a0236a8bab18fd5654516b985'),
    ('20261013150000_waste_cost_tracking', '2abf5ca7ec82b7c0959f1ae2afbcaa27d79492b0358f9f4c625bbc27394f1cd4', 'ffe6b368e95907b36441f3e9e858fb19643b0cd05e33a393a6d570d29a65a007')
  ) AS known(name, original_checksum, recovered_checksum) LOOP
    SELECT checksum INTO recorded FROM public._prisma_migrations
    WHERE migration_name = entry.name AND finished_at IS NOT NULL AND rolled_back_at IS NULL;
    IF recorded IS NULL OR recorded = entry.recovered_checksum THEN CONTINUE; END IF;
    IF recorded <> entry.original_checksum THEN
      RAISE EXCEPTION 'Unrecognized migration checksum for %. Review history before continuing.', entry.name;
    END IF;

    IF entry.name = '20261013140000_auth_sessions_lockout' THEN
      SELECT count(*) INTO object_count FROM (VALUES
        ('users','failed_login_count','integer',true), ('users','locked_until','timestamp(3) without time zone',false),
        ('user_sessions','id','text',true), ('user_sessions','user_id','text',true),
        ('user_sessions','created_at','timestamp(3) without time zone',true), ('user_sessions','expires_at','timestamp(3) without time zone',true),
        ('user_sessions','ip','text',false), ('user_sessions','user_agent','text',false)
      ) required(table_name,column_name,column_type,required_not_null)
      JOIN pg_attribute a ON a.attrelid = to_regclass('public.' || required.table_name) AND a.attname = required.column_name
        AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod) = required.column_type AND a.attnotnull = required.required_not_null;
      IF object_count <> 8 OR NOT EXISTS (
        SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
        WHERE d.adrelid='public.users'::regclass AND a.attname='failed_login_count'
          AND regexp_replace(pg_get_expr(d.adbin,d.adrelid),'[()[:space:]]','','g') ~ '^0(::integer)?$'
      ) OR NOT EXISTS (
        SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
        WHERE d.adrelid='public.user_sessions'::regclass AND a.attname='created_at'
          AND pg_get_expr(d.adbin,d.adrelid) IN ('CURRENT_TIMESTAMP','now()')
      ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.user_sessions'::regclass AND contype='p'
          AND pg_get_constraintdef(oid)='PRIMARY KEY (id)'
      ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.user_sessions'::regclass AND contype='f'
          AND confrelid='public.users'::regclass AND confdeltype='c' AND confupdtype='c'
          AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (user_id) REFERENCES users(id)%'
      ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='users_failed_login_count_check' AND contype='c'
          AND pg_get_constraintdef(oid)='CHECK ((failed_login_count >= 0))'
      ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='user_sessions' AND indexname='user_sessions_user_id_idx'
          AND indexdef LIKE '%(user_id)'
      ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='user_sessions' AND indexname='user_sessions_expires_at_idx'
          AND indexdef LIKE '%(expires_at)'
      ) THEN RAISE EXCEPTION 'Recovered authentication schema does not match. History left unchanged.'; END IF;
    ELSE
      SELECT count(*) INTO object_count FROM (VALUES
        ('finished_goods_adjustments','cost_known','boolean'), ('finished_goods_adjustments','unit_cost','numeric(14,4)'),
        ('restock_visit_items','expired_cost','numeric(14,2)'), ('restock_visit_items','expired_unknown_units','integer')
      ) required(table_name,column_name,column_type)
      JOIN pg_attribute a ON a.attrelid=to_regclass('public.' || required.table_name) AND a.attname=required.column_name
        AND NOT a.attisdropped AND a.attnotnull AND format_type(a.atttypid,a.atttypmod)=required.column_type;
      SELECT object_count + count(*) INTO object_count FROM (VALUES
        ('finished_goods_adjustments','cost_known','^false$'), ('finished_goods_adjustments','unit_cost','^0(\.0+)?(::numeric)?$'),
        ('restock_visit_items','expired_cost','^0(\.0+)?(::numeric)?$'), ('restock_visit_items','expired_unknown_units','^0(::integer)?$')
      ) required(table_name,column_name,default_pattern)
      JOIN pg_attribute a ON a.attrelid=to_regclass('public.' || required.table_name) AND a.attname=required.column_name
      JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        AND regexp_replace(pg_get_expr(d.adbin,d.adrelid),'[()[:space:]]','','g') ~ required.default_pattern;
      IF object_count <> 8 OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.finished_goods_adjustments'::regclass AND conname='finished_goods_adjustments_unit_cost_check'
          AND contype='c' AND pg_get_constraintdef(oid)='CHECK ((unit_cost >= (0)::numeric))'
      ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.restock_visit_items'::regclass AND conname='restock_expired_cost_check' AND contype='c'
          AND pg_get_constraintdef(oid)='CHECK (((expired_cost >= (0)::numeric) AND (expired_unknown_units >= 0) AND (expired_unknown_units <= count_expired_returned)))'
      ) THEN RAISE EXCEPTION 'Recovered waste-cost schema does not match. History left unchanged.'; END IF;
    END IF;

    UPDATE public._prisma_migrations SET checksum=entry.recovered_checksum
    WHERE migration_name=entry.name AND checksum=entry.original_checksum AND finished_at IS NOT NULL AND rolled_back_at IS NULL;
  END LOOP;
END
$reconcile$;
