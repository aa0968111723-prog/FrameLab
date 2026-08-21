-- Spec tables reserved in v0.1. No fake pose/depth payloads.
-- Applied once via _migrations / PGLite startup.

alter table characters add column reference_image text not null default '';
alter table characters add column embedding text;
alter table characters add column metadata_json text not null default '{}';

alter table objects add column metadata_json text not null default '{}';

alter table videos add column user_id text;
alter table videos add column source_path text not null default '';
alter table videos add column status text not null default 'ready';

create table if not exists keyframes (
  id text primary key,
  timeline_id text not null,
  frame_id text not null,
  kind text not null default 'KEY',
  locked boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists keyframes_frame_idx on keyframes (frame_id);

create table if not exists poses (
  id text primary key,
  frame_id text not null,
  provider text not null,
  joints_json text not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists tracking_tracks (
  id text primary key,
  project_id text not null,
  name text not null,
  kind text not null default 'custom',
  created_at timestamptz not null default now()
);

create table if not exists motion_data (
  id text primary key,
  timeline_id text not null,
  frame_number integer not null,
  magnitude double precision not null default 0,
  direction double precision not null default 0,
  diff double precision not null default 0,
  provider text not null default 'block-match-16',
  created_at timestamptz not null default now()
);
create index if not exists motion_data_timeline_idx on motion_data (timeline_id, frame_number);

create table if not exists depth_maps (
  id text primary key,
  frame_id text not null,
  provider text not null,
  path text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists segmentations (
  id text primary key,
  frame_id text not null,
  provider text not null,
  kind text not null default 'region',
  path text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists repair_jobs (
  id text primary key,
  job_id text,
  timeline_id text not null,
  start_frame integer not null,
  end_frame integer not null,
  method text not null,
  created_at timestamptz not null default now()
);

create table if not exists mcp_rate_events (
  id text primary key,
  client_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists mcp_rate_client_idx on mcp_rate_events (client_id, created_at);
