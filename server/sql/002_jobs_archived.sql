-- Backs the "Archive application" action in the redesigned dashboard.
-- Archiving hides a row from the pipeline without deleting the parsed
-- history, so an archived application can still be recovered.
-- Additive and safe to run against an existing jobs table.
alter table jobs add column if not exists archived boolean not null default false;

create index if not exists jobs_user_active_idx on jobs (user_id) where archived = false;
