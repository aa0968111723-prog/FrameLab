-- Motion path editing: user-dragged trail points become MotionConstraints.
-- Does not store pixels and must not rewrite keyframes.

create table if not exists motion_constraints (
  id text primary key,
  project_id text not null,
  timeline_id text not null,
  frame_id text,
  frame_number integer not null,
  name text not null,
  x double precision not null,
  y double precision not null,
  previous_x double precision not null default 0,
  previous_y double precision not null default 0,
  source text not null default 'user',
  kind text not null default 'MOTION_PATH',
  revision_id text,
  created_at timestamptz not null default now()
);

create index if not exists motion_constraints_project_idx on motion_constraints (project_id, name);
create index if not exists motion_constraints_frame_idx on motion_constraints (frame_number, name);
