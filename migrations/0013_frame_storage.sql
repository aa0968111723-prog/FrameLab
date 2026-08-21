-- Frame pixels live on disk. DB keeps paths + metadata only.
alter table frames add column full_asset text not null default '';
alter table frames add column preview_asset text not null default '';
alter table frames add column thumbnail_asset text not null default '';
