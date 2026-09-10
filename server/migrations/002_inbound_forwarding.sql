-- Forwarding-based ingestion: a second, free path alongside Gmail OAuth.
-- Additive only -- no existing table is touched. Idempotent, safe to re-run.

-- One alias per user. The alias is what the user forwards mail to (either via
-- Gmail's native "Forward a copy" setting, or a filter's "Forward it to").
create table if not exists inbound_addresses (
  user_id      integer primary key references users (id) on delete cascade,
  alias        text unique not null,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Audit trail of every inbound webhook delivery, kept regardless of whether
-- classification succeeds -- this is the only record of what actually
-- arrived, since (unlike Gmail) there's no upstream inbox to re-fetch from
-- if something needs investigating later.
create table if not exists inbound_emails (
  id            serial primary key,
  alias         text not null,
  raw_from      text,
  raw_subject   text,
  raw_body      text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists inbound_emails_alias_idx on inbound_emails (alias);

-- Per-message classification for forwarded mail, mirroring
-- message_classifications' shape (see migration 001) for the Gmail path.
-- Kept as its own table rather than merged into message_classifications:
-- forwarded mail has no Gmail message id to key on, and the two ingestion
-- paths regenerate a job's stage/notes independently (see sync/inbound.js).
create table if not exists inbound_message_classifications (
  user_id           integer not null references users (id) on delete cascade,
  inbound_email_id  integer not null references inbound_emails (id) on delete cascade,
  classified_at     timestamptz not null default now(),
  message_date      timestamptz,

  is_noise          boolean not null default false,
  reason            text,

  stage             text,
  detail            text,
  company           text,
  job_title         text,
  job_id            text,
  ats               text,
  is_third_party    boolean not null default false,
  source            text,

  primary key (user_id, inbound_email_id)
);

create index if not exists inbound_message_classifications_user_idx
  on inbound_message_classifications (user_id);
