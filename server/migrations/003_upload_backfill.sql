-- Client-side mbox upload: a third ingestion path for backfilling history
-- that neither OAuth (bounded by the user's chosen sync window, but at least
-- able to re-read it) nor forwarding (forward-only -- a filter can't route
-- mail that already arrived) can reach on their own. Reuses inbound_emails /
-- inbound_message_classifications (see migration 002) since both already
-- exist to hold non-Gmail-API-id mail and drive the same job-upsert path.
--
-- Every statement is idempotent, so running this more than once is safe.
-- Additive only -- no existing column or row is touched.

alter table inbound_emails
  add column if not exists user_id integer references users (id) on delete cascade,
  add column if not exists source text not null default 'mailgun',
  add column if not exists message_id_header text;

-- Uploaded rows have no forwarding alias to key on -- there's no address
-- involved, just a logged-in user and a file. alias stays required for the
-- mailgun rows it was designed for -- only the NOT NULL constraint moves.
alter table inbound_emails alter column alias drop not null;

-- Dedup: re-uploading the same export (or a date range that overlaps a
-- previous upload) must not create duplicate rows or re-run the LLM on mail
-- already classified. Scoped to "message_id_header is not null" so mailgun
-- rows, which never set it, are untouched by this constraint.
create unique index if not exists inbound_emails_user_message_id_idx
  on inbound_emails (user_id, message_id_header)
  where message_id_header is not null;

create index if not exists inbound_emails_user_id_idx on inbound_emails (user_id);
