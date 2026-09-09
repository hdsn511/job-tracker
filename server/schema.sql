-- Run once against the new Neon database (Neon console -> SQL Editor).
-- Reconstructed from the controller code, since the original Supabase
-- project was paused and unreachable during migration — if your real
-- schema had extra constraints/columns, adjust this first.

create table if not exists users (
  id serial primary key,
  email text unique not null,
  password text not null,
  created_at timestamptz default now()
);

create table if not exists jobs (
  id serial primary key,
  user_id integer references users(id) on delete cascade,
  company_name text not null,
  job_title text not null,
  status text not null default 'Applied',
  application_date date,
  notes text,
  archived boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists jobs_user_active_idx on jobs (user_id) where archived = false;
