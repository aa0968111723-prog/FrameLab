-- SAM 2 masks: metadata + contour in DB, never bulk pixels.

alter table segmentations add column if not exists frame_number integer;
alter table segmentations add column if not exists object_id text;
alter table segmentations add column if not exists bbox_json text not null default '{}';
alter table segmentations add column if not exists contour_json text not null default '[]';
alter table segmentations add column if not exists score double precision;
alter table segmentations add column if not exists confidence double precision;
alter table segmentations add column if not exists status text not null default 'ok';
alter table segmentations add column if not exists area double precision;
alter table segmentations add column if not exists direction text;
alter table segmentations add column if not exists warning text;
alter table segmentations add column if not exists model_run_id text;

create index if not exists segmentations_frame_idx on segmentations (frame_id);
create index if not exists segmentations_object_idx on segmentations (object_id);
