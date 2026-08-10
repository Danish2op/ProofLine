-- Synthetic Proofline demo data only. No production identities, targets, or credentials.
insert into public.workspaces (id, slug, name, is_synthetic)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-demo', 'Synthetic Demo Workspace', true)
on conflict (id) do nothing;

insert into public.agents (id, workspace_id, pubkey, display_name, status, delegated_by)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  repeat('a', 64),
  'synthetic-proposer@example.invalid',
  'active',
  repeat('b', 64)
)
on conflict (workspace_id, pubkey) do nothing;

insert into public.tool_definitions (id, workspace_id, name, definition_hash, metadata_json)
values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'sandbox.deploy',
  repeat('c', 64),
  '{"synthetic":true,"target":"sandbox://synthetic-demo.example.invalid/staging"}'::jsonb
)
on conflict (workspace_id, definition_hash) do nothing;

insert into public.policies (id, workspace_id, version, document_json, snapshot_hash)
values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'synthetic-mvp-1',
  '{"label":"synthetic demo policy","approval_required":true}'::jsonb,
  repeat('d', 64)
)
on conflict (workspace_id, version) do nothing;

insert into public.demo_runs (id, workspace_id, label, reset_key, state)
values (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'Synthetic deployment rehearsal',
  'synthetic-reset-001',
  'ready'
)
on conflict (workspace_id, reset_key) do nothing;
