import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fail } from "../domain/errors.ts";

export const STORAGE_DIRS = [
  "source",
  "frames",
  "thumbnails",
  "masks",
  "flow",
  "depth",
  "generated",
  "repaired",
  "renders",
  "revisions",
  "originals",
] as const;

export type StorageKind = (typeof STORAGE_DIRS)[number];

export function dataRoot(): string {
  return process.env.FRAMELAB_DATA_DIR || path.join(process.cwd(), "data");
}

export function projectRoot(projectId: string): string {
  assertSafeId(projectId);
  return path.join(dataRoot(), "projects", projectId);
}

export function assertSafeId(id: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id.includes("..")) {
    fail("STORAGE_ERROR", "Invalid storage id");
  }
}

export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const trimmed = base.slice(0, 80) || "file";
  if (trimmed.includes("..")) fail("STORAGE_ERROR", "Invalid filename");
  return trimmed;
}

export function assertInsideData(resolved: string): string {
  const root = path.resolve(dataRoot());
  const full = path.resolve(resolved);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(prefix)) {
    fail("STORAGE_ERROR", "Path escapes storage root");
  }
  return full;
}

export async function ensureProjectLayout(projectId: string): Promise<string> {
  const root = projectRoot(projectId);
  await mkdir(root, { recursive: true });
  for (const dir of STORAGE_DIRS) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  return root;
}

export async function putJpeg(
  projectId: string,
  kind: StorageKind,
  name: string,
  jpegBase64: string,
): Promise<string> {
  await ensureProjectLayout(projectId);
  const file = assertInsideData(
    path.join(projectRoot(projectId), kind, safeFilename(name)),
  );
  await writeFile(file, Buffer.from(jpegBase64, "base64"));
  return file;
}

export async function putBytes(
  projectId: string,
  kind: StorageKind,
  name: string,
  bytes: Buffer,
): Promise<string> {
  await ensureProjectLayout(projectId);
  const file = assertInsideData(
    path.join(projectRoot(projectId), kind, safeFilename(name)),
  );
  await writeFile(file, bytes);
  return file;
}

export async function getBytes(filePath: string): Promise<Buffer> {
  const full = assertInsideData(filePath);
  return readFile(full);
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(assertInsideData(filePath));
    return true;
  } catch {
    return false;
  }
}

export type StorageProvider = {
  putJpeg: typeof putJpeg;
  putBytes: typeof putBytes;
  getBytes: typeof getBytes;
};

export const LocalStorage: StorageProvider = { putJpeg, putBytes, getBytes };

export const S3Storage: StorageProvider = {
  async putJpeg() {
    fail("NOT_IMPLEMENTED", "S3 storage is not configured in v0.1");
  },
  async putBytes() {
    fail("NOT_IMPLEMENTED", "S3 storage is not configured in v0.1");
  },
  async getBytes() {
    fail("NOT_IMPLEMENTED", "S3 storage is not configured in v0.1");
  },
};
