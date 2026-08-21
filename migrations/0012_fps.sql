-- Source video fps is independent of playback fps / drawing exposure.
alter table videos add column source_fps integer not null default 0;
