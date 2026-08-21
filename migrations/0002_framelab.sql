-- FrameLab core schema. Per-user rows always carry user_id (TEXT).
-- Frame binaries live as base64 JPEG text, never as Postgres bytea.

create table if not exists projects (
  id text primary key,
  user_id text not null,
  name text not null,
  description text not null default '',
  fps integer not null default 24,
  width integer not null default 480,
  height integer not null default 270,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_id_idx on projects (user_id);

create table if not exists videos (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  filename text not null,
  mime_type text not null,
  duration_ms integer not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  frame_count integer not null default 0,
  content_hash text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists timelines (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  video_id text,
  name text not null default 'Main',
  fps integer not null default 24,
  frame_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists timelines_project_idx on timelines (project_id);

create table if not exists frames (
  id text primary key,
  timeline_id text not null references timelines(id) on delete cascade,
  frame_number integer not null,
  timestamp_ms integer not null default 0,
  duration_ms integer not null default 42,
  frame_type text not null default 'INBETWEEN',
  image_data text not null default '',
  thumbnail_data text not null default '',
  width integer not null,
  height integer not null,
  is_locked boolean not null default false,
  notes text not null default '',
  content_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists frames_timeline_number_idx on frames (timeline_id, frame_number);
create index if not exists frames_timeline_idx on frames (timeline_id);

create table if not exists characters (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists objects (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists frame_characters (
  frame_id text not null references frames(id) on delete cascade,
  character_id text not null references characters(id) on delete cascade,
  visible boolean not null default true,
  occluded boolean not null default false,
  primary key (frame_id, character_id)
);

create table if not exists frame_objects (
  frame_id text not null references frames(id) on delete cascade,
  object_id text not null references objects(id) on delete cascade,
  visible boolean not null default true,
  primary key (frame_id, object_id)
);

create table if not exists graph_edges (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  edge_type text not null,
  from_kind text not null,
  from_id text not null,
  to_kind text not null,
  to_id text not null,
  payload_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists graph_edges_project_idx on graph_edges (project_id, edge_type);

create table if not exists consistency_results (
  id text primary key,
  frame_id text not null references frames(id) on delete cascade,
  timeline_id text not null,
  scores_json text not null,
  severity text not null,
  repair_start integer,
  repair_end integer,
  categories_json text not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists consistency_timeline_idx on consistency_results (timeline_id);

create table if not exists jobs (
  id text primary key,
  user_id text not null,
  project_id text,
  type text not null,
  state text not null default 'queued',
  progress integer not null default 0,
  payload_json text not null default '{}',
  result_json text not null default '{}',
  provider text,
  model_name text,
  model_version text,
  device text,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jobs_user_idx on jobs (user_id, created_at);

create table if not exists revisions (
  id text primary key,
  project_id text not null,
  frame_id text,
  action text not null,
  source text not null,
  caller text not null,
  previous_json text not null default '{}',
  new_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists revisions_project_idx on revisions (project_id, created_at);

create table if not exists mcp_clients (
  id text primary key,
  user_id text not null,
  name text not null,
  token_hash text not null,
  token_prefix text not null,
  scopes text not null default 'READ,ANALYZE',
  project_scope text not null default 'all',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists mcp_clients_user_idx on mcp_clients (user_id);
create unique index if not exists mcp_clients_hash_idx on mcp_clients (token_hash);

create table if not exists mcp_audit_logs (
  id text primary key,
  user_id text not null,
  client_id text,
  tool text not null,
  caller text not null default '',
  scope_used text not null default '',
  arguments_json text not null default '{}',
  project_id text,
  frame_range text,
  status text not null,
  duration_ms integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_audit_user_idx on mcp_audit_logs (user_id, created_at);

create table if not exists model_runs (
  id text primary key,
  job_id text,
  provider text not null,
  model_name text not null,
  model_version text not null default '',
  device text not null default 'cpu',
  frame_id text,
  cache_hit boolean not null default false,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists analysis_cache (
  id text primary key,
  frame_hash text not null,
  model_name text not null,
  model_version text not null default '',
  config_hash text not null default '',
  result_json text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists analysis_cache_key_idx
  on analysis_cache (frame_hash, model_name, model_version, config_hash);

create table if not exists tracking_points (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  x integer not null default 0,
  y integer not null default 0,
  frame_number integer not null default 0,
  created_at timestamptz not null default now()
);
