-- V0.4 visual annotations. MCP returns these; the frontend renders them.

create table if not exists visual_annotations (
  id text primary key,
  user_id text not null,
  project_id text,
  session_id text,
  frame_id text,
  frame_number integer not null,
  type text not null,
  coordinates_json text not null,
  label text not null default '',
  severity text,
  source text not null default 'ai',
  category text,
  linked_analysis_id text,
  created_at timestamptz not null default now()
);
create index if not exists visual_annotations_user_idx on visual_annotations (user_id, project_id);
create index if not exists visual_annotations_session_idx on visual_annotations (session_id);
