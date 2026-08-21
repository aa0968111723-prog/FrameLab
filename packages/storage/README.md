Storage provider: `src/lib/storage/local.ts`.

v0.1 uses **LocalStorage** under `data/projects/{id}/{source,frames,thumbnails,...}`. Frame JPEGs are still mirrored in Postgres as base64 so the workstation can load without a file server. S3 / R2 adapters return `NOT_IMPLEMENTED`.
