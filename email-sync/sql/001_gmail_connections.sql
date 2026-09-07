-- Run once against the Neon database before the sync script's first use.
-- One row per job-tracker user who has connected a Gmail account. Today
-- there's exactly one row (the app's only user); a future "Connect Gmail"
-- flow in the app would populate this same table for additional users, and
-- run.js already loops over every row here.
create table if not exists gmail_connections (
  user_id integer primary key references users(id) on delete cascade,
  gmail_address text not null,
  refresh_token_encrypted text not null,
  last_synced_at bigint,
  connected_at timestamptz not null default now()
);
