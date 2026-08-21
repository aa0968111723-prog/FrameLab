-- Versioned frame assets: original JPEG is never overwritten.
alter table frames add column original_asset text not null default '';
alter table frames add column active_asset text not null default '';
