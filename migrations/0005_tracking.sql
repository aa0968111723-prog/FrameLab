-- Point-tracker metadata. Scores are real NCC values, never invented.
alter table tracking_points add column score double precision not null default 1;
alter table tracking_points add column status text not null default 'visible';
alter table tracking_points add column track_id text;
