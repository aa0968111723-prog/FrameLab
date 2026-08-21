-- V0.2 Assist: problem ranges, repair plans, richer motion/pose persistence.

alter table revisions add column timeline_id text;
alter table revisions add column start_frame integer;
alter table revisions add column end_frame integer;
alter table revisions add column status text not null default 'open';

alter table motion_data add column frame_a integer;
alter table motion_data add column frame_b integer;
alter table motion_data add column median_motion double precision not null default 0;
alter table motion_data add column velocity_ratio double precision;
alter table motion_data add column direction_change_deg double precision;
alter table motion_data add column flow_asset text not null default '';
alter table motion_data add column region_json text not null default 'null';

alter table poses add column frame_number integer;
alter table poses add column character_id text;
alter table poses add column bbox_json text not null default '{}';
alter table poses add column model_run_id text;

create table if not exists problem_ranges (
  id text primary key,
  timeline_id text not null,
  start_frame integer not null,
  end_frame integer not null,
  peak_frame integer not null,
  category text not null,
  severity text not null,
  score double precision not null default 0,
  reason text not null default '',
  evidence_json text not null default '{}',
  context_snapshot_id text,
  created_at timestamptz not null default now()
);
create index if not exists problem_ranges_timeline_idx on problem_ranges (timeline_id);

create table if not exists repair_plans (
  id text primary key,
  project_id text not null,
  timeline_id text not null,
  problem_start integer not null,
  problem_end integer not null,
  repair_start integer not null,
  repair_end integer not null,
  provider text not null default 'linear-blend',
  protected_frames_json text not null default '[]',
  reason text not null default '',
  status text not null default 'draft',
  created_by text not null default '',
  context_snapshot_id text,
  revision_id text,
  created_at timestamptz not null default now()
);
create index if not exists repair_plans_timeline_idx on repair_plans (timeline_id);

create table if not exists revision_frames (
  id text primary key,
  revision_id text not null,
  frame_id text not null,
  frame_number integer not null,
  previous_hash text not null default '',
  created_at timestamptz not null default now()
);
