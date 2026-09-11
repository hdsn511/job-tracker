-- Cross-path message identity: the RFC 5322 Message-Id header, the one
-- identifier stable across ALL three ingestion paths (Gmail OAuth, Mailgun
-- forwarding, mbox upload) for what is physically the same email.
--
-- message_classifications (OAuth) and inbound_message_classifications
-- (forwarding/upload) key on different, path-specific ids and classify
-- independently. When the same email arrives via both paths -- a common
-- backfill-overlaps-OAuth-window case -- each gets its own row, and if a
-- classifier fix lands between the two classification times, one row goes
-- stale while the other carries the correction. Nothing reconciled them:
-- getAllSignalMessages() unioned both, and deriveStage's terminal-wins rule
-- meant a stale Rejected could silently outrank a corrected Applied.
-- Confirmed against real data: a Microsoft application-confirmation email,
-- classified Rejected by a pre-fix OAuth cache entry and correctly Applied
-- by a post-fix upload row, left the job showing Rejected.
--
-- inbound_emails already has message_id_header (migration 003, upload-only
-- so far). This adds the OAuth-side column and lets sync/jobs.js's
-- getAllSignalMessages() recognize the same email arriving from both paths
-- and keep only the more recently (i.e. more likely correctly) classified
-- copy, rather than treating them as two independent messages.
--
-- Additive only, idempotent -- safe to re-run.

alter table message_classifications
  add column if not exists message_id_header text;

create index if not exists message_classifications_message_id_idx
  on message_classifications (user_id, message_id_header)
  where message_id_header is not null;
