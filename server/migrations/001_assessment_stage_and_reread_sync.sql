-- Assessment stage, re-read sync, and the LLM classification cache.
--
-- Every statement is idempotent (IF NOT EXISTS / guarded UPDATE), so running
-- this more than once is safe. Run with:  npm run migrate

-- ---------------------------------------------------------------------------
-- 1. Per-connection start date
-- ---------------------------------------------------------------------------
-- How far back the sync should ever look for this account, chosen by the user
-- at connect time. NULL means "fall back to the 30-day default", which keeps
-- existing connections behaving exactly as they do today.
alter table gmail_connections
  add column if not exists sync_start_date date;

-- ---------------------------------------------------------------------------
-- 2. Manual override protection
-- ---------------------------------------------------------------------------
-- The resync is now a re-read: it re-derives each job's stage from scratch and
-- will happily move a status DOWN when the mail says so. That must never stomp
-- a stage the user set by hand, so hand-edited rows are flagged and skipped.
alter table jobs
  add column if not exists manual_override boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. LLM classification cache
-- ---------------------------------------------------------------------------
-- The re-read re-examines the whole window on every run. Without a cache that
-- would re-send every message to the LLM each time. Keyed by Gmail message id
-- so a message is classified exactly once, ever.
--
-- Deliberately stores only DERIVED fields. The raw subject and body are never
-- persisted -- the point of the redaction boundary is undone if the mail is
-- sitting in our own database.
create table if not exists message_classifications (
  user_id            integer not null references users (id) on delete cascade,
  gmail_message_id   text    not null,
  classified_at      timestamptz not null default now(),
  -- The Date header of the message. Needed to rebuild the timeline and to
  -- decide which of two terminal outcomes is the later one, so it must be
  -- cached alongside the classification rather than re-fetched.
  message_date       timestamptz,

  is_noise           boolean not null default false,
  reason             text,

  stage              text,
  detail             text,
  company            text,
  job_title          text,
  job_id             text,
  ats                text,
  is_third_party     boolean not null default false,
  -- 'llm' | 'rules' | 'none' -- which engine decided the stage, so a drop in
  -- accuracy can be attributed rather than guessed at.
  source             text,

  primary key (user_id, gmail_message_id)
);

create index if not exists message_classifications_user_idx
  on message_classifications (user_id);

-- ---------------------------------------------------------------------------
-- 4. Backfill existing rows onto the new taxonomy
-- ---------------------------------------------------------------------------
-- Rows the old classifier marked "Interviewing" purely because of an
-- assessment note are moved to the new Assessment stage. Anything whose
-- timeline shows a genuine interview is left alone, as is anything the user
-- has edited by hand.
update jobs
   set status = 'Assessment'
 where status = 'Interviewing'
   and manual_override = false
   and notes ilike '%Assessment/OA%'
   and notes not ilike '%— Interview%';
