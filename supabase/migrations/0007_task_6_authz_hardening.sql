-- Task 6: approval events are written only by a server-side verifier.
-- Authenticated Data API callers must not be able to forge actor_pubkey or
-- bypass action ownership/policy checks. Server routes and workers use the
-- service role only after verifying the Supabase user and workspace policy.
drop policy if exists approval_events_reviewer_insert on public.approval_events;

revoke insert on table public.approval_events from authenticated;
grant insert on table public.approval_events to service_role;
