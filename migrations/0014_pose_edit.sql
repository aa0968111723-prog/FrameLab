-- Pose editing: user-dragged skeleton joints become PoseConstraints.
-- Does not store pixels. Frames stay untouched.

create table if not exists pose_constraints (
  id text primary key,
  project_id text not null,
  timeline_id text not null,
  frame_id text not null,
  frame_number integer not null,
  joint text not null,
  x double precision not null,
  y double precision not null,
  previous_x double precision not null default 0,
  previous_y double precision not null default 0,
  keypoints_json text not null default '[]',
  source text not null default 'user',
  kind text not null default 'POSE_JOINT',
  revision_id text,
  created_at timestamptz not null default now()
);

create index if not exists pose_constraints_frame_idx on pose_constraints (frame_id);
create index if not exists pose_constraints_timeline_idx on pose_constraints (timeline_id);
