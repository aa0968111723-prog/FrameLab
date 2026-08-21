-- Conversation layer + workspace sessions. Context is session-isolated per user.

create table if not exists workspace_sessions (
  id text primary key,
  user_id text not null,
  project_id text not null,
  timeline_id text,
  video_id text,
  current_frame integer,
  current_frame_id text,
  selected_range_json text not null default 'null',
  selected_frames_json text not null default '[]',
  selected_region_json text not null default 'null',
  selected_character_id text,
  selected_object_id text,
  onion_skin_json text not null default '{}',
  overlay_json text not null default '{}',
  conversation_id text,
  context_version integer not null default 0,
  context_json text not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists workspace_sessions_user_idx on workspace_sessions (user_id, project_id);

create table if not exists conversations (
  id text primary key,
  user_id text not null,
  project_id text not null,
  timeline_id text,
  title text not null default '',
  provider text not null default 'grok',
  mode text not null default 'ASK',
  context_locked boolean not null default false,
  locked_snapshot_json text not null default 'null',
  frame_start integer,
  frame_end integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_project_idx on conversations (project_id, user_id);

create table if not exists conversation_messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  context_snapshot_json text not null default '{}',
  context_version integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists conversation_messages_conv_idx on conversation_messages (conversation_id, created_at);

create table if not exists conversation_tool_calls (
  id text primary key,
  conversation_id text not null,
  message_id text,
  tool text not null,
  arguments_json text not null default '{}',
  status text not null default 'ok',
  duration_ms integer not null default 0,
  result_summary text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists conversation_tool_calls_conv_idx on conversation_tool_calls (conversation_id);

create table if not exists context_snapshots (
  id text primary key,
  user_id text not null,
  session_id text,
  conversation_id text,
  message_id text,
  snapshot_json text not null,
  context_version integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists context_snapshots_session_idx on context_snapshots (session_id);

create table if not exists region_selections (
  id text primary key,
  user_id text not null,
  session_id text,
  frame_id text,
  frame_number integer,
  selection_type text not null default 'rectangle',
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists region_selections_session_idx on region_selections (session_id);
