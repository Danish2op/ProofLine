-- Repair audit hashing for databases where pgcrypto is installed outside public.
create schema if not exists proofline_internal;
revoke all on schema proofline_internal from public;

create or replace function proofline_internal.sha256_json(payload jsonb)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  pgcrypto_schema name;
  result_hash text;
begin
  select namespace.nspname
  into pgcrypto_schema
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required for Proofline audit hashing';
  end if;

  if pg_catalog.to_regprocedure(
    pg_catalog.format('%I.digest(bytea,text)', pgcrypto_schema)
  ) is null then
    raise exception 'pgcrypto digest(bytea,text) is required for Proofline audit hashing';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    pgcrypto_schema
  ) into result_hash using payload::text;

  return result_hash;
end;
$$;

revoke all on function proofline_internal.sha256_json(jsonb) from public;

create or replace function public.record_action_passport_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.audit_events (
    workspace_id,
    actor_type,
    actor_id,
    event_type,
    aggregate_type,
    aggregate_id,
    before_hash,
    after_hash,
    metadata_json,
    occurred_at,
    correlation_id,
    causation_id
  ) values (
    new.workspace_id,
    'system',
    null,
    case when tg_op = 'INSERT' then 'action_passport.created' else 'action_passport.transitioned' end,
    'action_passport',
    new.id,
    case when tg_op = 'INSERT' then null else proofline_internal.sha256_json(pg_catalog.to_jsonb(old)) end,
    proofline_internal.sha256_json(pg_catalog.to_jsonb(new)),
    pg_catalog.jsonb_build_object('status', new.status),
    current_timestamp,
    null,
    null
  );
  return new;
end;
$$;
