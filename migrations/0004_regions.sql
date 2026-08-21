-- RegionNode reserved. No fake masks. regenerate_region stays PROVIDER_NOT_AVAILABLE.
create table if not exists regions (
  id text primary key,
  frame_id text not null,
  kind text not null default 'custom',
  path text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists regions_frame_idx on regions (frame_id);
