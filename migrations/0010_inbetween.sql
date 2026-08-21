-- V0.3 AI Inbetween Core: pairs, motion plans, candidates, generated metadata.

alter table frames add column exposure_count integer not null default 1;

create table if not exists keyframe_pairs (
  id text primary key,
  timeline_id text not null,
  start_frame_id text,
  end_frame_id text,
  start_frame_number integer not null,
  end_frame_number integer not null,
  frame_gap integer not null,
  desired_inbetween_count integer not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists keyframe_pairs_timeline_idx on keyframe_pairs (timeline_id);

create table if not exists motion_plans (
  id text primary key,
  pair_id text,
  timeline_id text not null,
  version integer not null default 1,
  plan_json text not null,
  curve text not null default 'ease_in_out',
  created_at timestamptz not null default now()
);
create index if not exists motion_plans_timeline_idx on motion_plans (timeline_id);

create table if not exists candidate_versions (
  id text primary key,
  project_id text not null,
  timeline_id text not null,
  pair_id text,
  motion_plan_id text,
  job_id text,
  provider text not null default 'linear-blend',
  model text not null default 'linear-blend',
  quality text not null default 'preview',
  status text not null default 'draft',
  seed integer,
  frames_json text not null default '[]',
  evaluation_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists candidate_versions_timeline_idx on candidate_versions (timeline_id);

create table if not exists generated_frame_issues (
  id text primary key,
  candidate_id text not null,
  frame_number integer not null,
  category text not null,
  severity text not null,
  score double precision not null default 0,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists generated_frame_issues_cand_idx on generated_frame_issues (candidate_id);
