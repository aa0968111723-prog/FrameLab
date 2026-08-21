/** FrameLab persistence. PGLite / Postgres via tagged SQL. */
import { getSql } from "@/lib/db";
import { nid } from "@/lib/domain/ids";

export type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  fps: number;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
};

export type TimelineRow = {
  id: string;
  project_id: string;
  video_id: string | null;
  name: string;
  fps: number;
  frame_count: number;
  created_at: string;
};

export type FrameRow = {
  id: string;
  timeline_id: string;
  frame_number: number;
  timestamp_ms: number;
  duration_ms: number;
  frame_type: string;
  image_data: string;
  thumbnail_data: string;
  width: number;
  height: number;
  is_locked: boolean;
  notes: string;
  content_hash: string;
  original_asset?: string | null;
  active_asset?: string | null;
  exposure_count?: number;
};

export type WorkspaceSessionRow = {
  id: string;
  user_id: string;
  project_id: string;
  timeline_id: string | null;
  video_id: string | null;
  current_frame: number | null;
  current_frame_id: string | null;
  selected_range_json: string;
  selected_frames_json: string;
  selected_region_json: string;
  selected_character_id: string | null;
  selected_object_id: string | null;
  onion_skin_json: string;
  overlay_json: string;
  conversation_id: string | null;
  context_version: number;
  context_json: string;
};

export type JobRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  type: string;
  state: string;
  progress: number;
  payload_json: string;
  result_json: string;
  provider: string | null;
  model_name: string | null;
  model_version: string | null;
  device: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

const FRAME_COLS = `
  id, timeline_id, frame_number, timestamp_ms, duration_ms, frame_type,
  image_data, thumbnail_data, width, height, is_locked, notes, content_hash,
  original_asset, active_asset, exposure_count
`;

export async function listProjects(userId: string) {
  const sql = await getSql();
  return sql<ProjectRow>`select * from projects where user_id = ${userId} order by updated_at desc`;
}

export async function getProject(userId: string, projectId: string) {
  const sql = await getSql();
  const rows = await sql<ProjectRow>`select * from projects where id = ${projectId} and user_id = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function insertProject(row: ProjectRow) {
  const sql = await getSql();
  await sql`
    insert into projects (id, user_id, name, description, fps, width, height, created_at, updated_at)
    values (${row.id}, ${row.user_id}, ${row.name}, ${row.description}, ${row.fps}, ${row.width}, ${row.height}, ${row.created_at}, ${row.updated_at})
  `;
}

export async function deleteProject(userId: string, projectId: string) {
  const sql = await getSql();
  await sql`delete from projects where id = ${projectId} and user_id = ${userId}`;
}

export async function listTimelines(projectId: string) {
  const sql = await getSql();
  return sql<TimelineRow>`select * from timelines where project_id = ${projectId} order by created_at`;
}

export async function getTimeline(id: string) {
  const sql = await getSql();
  const rows = await sql<TimelineRow>`select * from timelines where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function insertTimeline(row: TimelineRow) {
  const sql = await getSql();
  await sql`
    insert into timelines (id, project_id, video_id, name, fps, frame_count, created_at)
    values (${row.id}, ${row.project_id}, ${row.video_id}, ${row.name}, ${row.fps}, ${row.frame_count}, ${row.created_at})
  `;
}

export async function setTimelineFrameCount(id: string, count: number) {
  const sql = await getSql();
  await sql`update timelines set frame_count = ${count} where id = ${id}`;
}

export async function listFramesMeta(timelineId: string) {
  const sql = await getSql();
  return sql<FrameRow>`
    select id, timeline_id, frame_number, timestamp_ms, duration_ms, frame_type,
      thumbnail_data, width, height, is_locked, notes, content_hash,
      original_asset, active_asset, exposure_count, '' as image_data
    from frames where timeline_id = ${timelineId} order by frame_number
  `;
}

export async function listFramesFull(timelineId: string) {
  const sql = await getSql();
  return sql<FrameRow>`
    select id, timeline_id, frame_number, timestamp_ms, duration_ms, frame_type,
      image_data, thumbnail_data, width, height, is_locked, notes, content_hash,
      original_asset, active_asset, exposure_count
    from frames where timeline_id = ${timelineId} order by frame_number
  `;
}

export async function getFrame(id: string) {
  const sql = await getSql();
  const rows = await sql<FrameRow>`
    select id, timeline_id, frame_number, timestamp_ms, duration_ms, frame_type,
      image_data, thumbnail_data, width, height, is_locked, notes, content_hash,
      original_asset, active_asset, exposure_count
    from frames where id = ${id} limit 1
  `;
  return rows[0] ?? null;
}

export async function getFrameByNumber(timelineId: string, n: number) {
  const sql = await getSql();
  const rows = await sql<FrameRow>`
    select id, timeline_id, frame_number, timestamp_ms, duration_ms, frame_type,
      image_data, thumbnail_data, width, height, is_locked, notes, content_hash,
      original_asset, active_asset, exposure_count
    from frames where timeline_id = ${timelineId} and frame_number = ${n} limit 1
  `;
  return rows[0] ?? null;
}

export async function insertFrame(row: {
  id: string;
  timeline_id: string;
  frame_number: number;
  timestamp_ms: number;
  duration_ms: number;
  frame_type: string;
  image_data: string;
  thumbnail_data: string;
  width: number;
  height: number;
  content_hash: string;
  notes?: string;
  is_locked?: boolean;
}) {
  const sql = await getSql();
  await sql`
    insert into frames (
      id, timeline_id, frame_number, timestamp_ms, duration_ms, frame_type,
      image_data, thumbnail_data, width, height, is_locked, notes, content_hash,
      original_asset, active_asset
    ) values (
      ${row.id}, ${row.timeline_id}, ${row.frame_number}, ${row.timestamp_ms}, ${row.duration_ms},
      ${row.frame_type}, ${row.image_data}, ${row.thumbnail_data}, ${row.width}, ${row.height},
      ${row.is_locked ?? false}, ${row.notes ?? ""}, ${row.content_hash},
      ${row.image_data ? "original" : ""}, ${row.image_data ? "active" : ""}
    )
  `;
}

export async function updateFrame(
  id: string,
  patch: Partial<{
    image_data: string;
    thumbnail_data: string;
    content_hash: string;
    frame_type: string;
    duration_ms: number;
    notes: string;
    is_locked: boolean;
    width: number;
    height: number;
    original_asset: string;
    active_asset: string;
    exposure_count: number;
  }>,
) {
  const sql = await getSql();
  const cur = await getFrame(id);
  if (!cur) return;
  await sql`
    update frames set
      image_data = ${patch.image_data ?? cur.image_data},
      thumbnail_data = ${patch.thumbnail_data ?? cur.thumbnail_data},
      content_hash = ${patch.content_hash ?? cur.content_hash},
      frame_type = ${patch.frame_type ?? cur.frame_type},
      duration_ms = ${patch.duration_ms ?? cur.duration_ms},
      notes = ${patch.notes ?? cur.notes},
      is_locked = ${patch.is_locked ?? cur.is_locked},
      width = ${patch.width ?? cur.width},
      height = ${patch.height ?? cur.height},
      original_asset = ${patch.original_asset ?? cur.original_asset ?? ""},
      active_asset = ${patch.active_asset ?? cur.active_asset ?? ""},
      exposure_count = ${patch.exposure_count ?? cur.exposure_count ?? 1},
      updated_at = now()
    where id = ${id}
  `;
}

export async function deleteFrameRow(id: string) {
  const sql = await getSql();
  await sql`delete from frames where id = ${id}`;
}

export async function shiftFramesAfter(timelineId: string, from: number, delta: number) {
  const sql = await getSql();
  await sql`update frames set frame_number = frame_number + 100000
    where timeline_id = ${timelineId} and frame_number >= ${from}`;
  await sql`update frames set frame_number = frame_number - 100000 + ${delta}
    where timeline_id = ${timelineId} and frame_number >= ${from + 100000}`;
}

export async function listCharacters(projectId: string) {
  const sql = await getSql();
  return sql<{ id: string; name: string }>`select id, name from characters where project_id = ${projectId} order by created_at`;
}

export async function getCharacter(id: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; project_id: string; name: string; notes: string }>`select id, project_id, name, notes from characters where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function insertCharacter(row: { id: string; projectId: string; name: string }) {
  const sql = await getSql();
  await sql`insert into characters (id, project_id, name) values (${row.id}, ${row.projectId}, ${row.name})`;
}

export async function assignCharacter(frameId: string, characterId: string) {
  const sql = await getSql();
  await sql`
    insert into frame_characters (frame_id, character_id, visible, occluded)
    values (${frameId}, ${characterId}, true, false)
    on conflict (frame_id, character_id) do update set visible = true
  `;
}

export async function setCharacterVisibility(
  frameId: string,
  characterId: string,
  opts: { visible?: boolean; occluded?: boolean },
) {
  const sql = await getSql();
  await sql`
    update frame_characters set
      visible = ${opts.visible ?? true},
      occluded = ${opts.occluded ?? false}
    where frame_id = ${frameId} and character_id = ${characterId}
  `;
}

export async function characterTrack(characterId: string) {
  const sql = await getSql();
  return sql<{ frame_id: string; frame_number: number; visible: boolean; occluded: boolean }>`
    select fc.frame_id, f.frame_number, fc.visible, fc.occluded
    from frame_characters fc join frames f on f.id = fc.frame_id
    where fc.character_id = ${characterId} order by f.frame_number
  `;
}

export async function listProjectAssignments(projectId: string) {
  const sql = await getSql();
  return sql<{
    character_id: string;
    name: string;
    visible: boolean;
    occluded: boolean;
    frame_number: number;
    frame_id: string;
  }>`
    select c.id as character_id, c.name, fc.visible, fc.occluded, f.frame_number, f.id as frame_id
    from frame_characters fc
    join characters c on c.id = fc.character_id
    join frames f on f.id = fc.frame_id
    join timelines t on t.id = f.timeline_id
    where t.project_id = ${projectId}
    order by f.frame_number
  `;
}

export async function listObjects(projectId: string) {
  const sql = await getSql();
  return sql<{ id: string; name: string }>`select id, name from objects where project_id = ${projectId}`;
}

export async function getObject(id: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; project_id: string; name: string; notes: string }>`select id, project_id, name, notes from objects where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function insertObject(row: { id: string; projectId: string; name: string }) {
  const sql = await getSql();
  await sql`insert into objects (id, project_id, name) values (${row.id}, ${row.projectId}, ${row.name})`;
}

export async function assignObject(frameId: string, objectId: string) {
  const sql = await getSql();
  await sql`
    insert into frame_objects (frame_id, object_id, visible)
    values (${frameId}, ${objectId}, true)
    on conflict (frame_id, object_id) do update set visible = true
  `;
}

export async function objectTrack(objectId: string) {
  const sql = await getSql();
  return sql<{ frame_id: string; frame_number: number }>`
    select fo.frame_id, f.frame_number from frame_objects fo
    join frames f on f.id = fo.frame_id where fo.object_id = ${objectId} order by f.frame_number
  `;
}

export async function listProjectObjectAssignments(projectId: string) {
  const sql = await getSql();
  return sql<{ object_id: string; name: string; frame_number: number; frame_id: string }>`
    select o.id as object_id, o.name, f.frame_number, f.id as frame_id
    from frame_objects fo
    join objects o on o.id = fo.object_id
    join frames f on f.id = fo.frame_id
    join timelines t on t.id = f.timeline_id
    where t.project_id = ${projectId}
  `;
}

export async function insertEdge(row: {
  projectId: string;
  edgeType: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  payload?: unknown;
}) {
  const sql = await getSql();
  const id = nid("edg");
  await sql`
    insert into graph_edges (id, project_id, edge_type, from_kind, from_id, to_kind, to_id, payload_json)
    values (${id}, ${row.projectId}, ${row.edgeType}, ${row.fromKind}, ${row.fromId}, ${row.toKind}, ${row.toId}, ${JSON.stringify(row.payload ?? {})})
  `;
  return id;
}

export async function listEdges(projectId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    edge_type: string;
    from_kind: string;
    from_id: string;
    to_kind: string;
    to_id: string;
    payload_json: string;
  }>`select id, edge_type, from_kind, from_id, to_kind, to_id, payload_json from graph_edges where project_id = ${projectId}`;
}

export async function listConsistency(timelineId: string) {
  const sql = await getSql();
  return sql<{
    frame_id: string;
    frame_number: number;
    scores_json: string;
    severity: string;
    repair_start: number | null;
    repair_end: number | null;
    categories_json: string;
  }>`
    select c.frame_id, f.frame_number, c.scores_json, c.severity, c.repair_start, c.repair_end, c.categories_json
    from consistency_results c join frames f on f.id = c.frame_id
    where c.timeline_id = ${timelineId}
    order by f.frame_number
  `;
}

export async function getConsistencyForFrame(frameId: string) {
  const sql = await getSql();
  const rows = await sql<{ scores_json: string; severity: string }>`
    select scores_json, severity from consistency_results where frame_id = ${frameId} order by created_at desc limit 1
  `;
  return rows[0] ?? null;
}

export async function replaceConsistencyForFrames(
  timelineId: string,
  rows: {
    frameId: string;
    result: {
      scores: Record<string, number>;
      severity: string;
      categories: string[];
      repairWindow: [number, number] | null;
    };
  }[],
) {
  const sql = await getSql();
  for (const r of rows) {
    await sql`delete from consistency_results where frame_id = ${r.frameId}`;
    const id = nid("con");
    await sql`
      insert into consistency_results (id, frame_id, timeline_id, scores_json, severity, repair_start, repair_end, categories_json)
      values (
        ${id}, ${r.frameId}, ${timelineId}, ${JSON.stringify(r.result.scores)}, ${r.result.severity},
        ${r.result.repairWindow?.[0] ?? null}, ${r.result.repairWindow?.[1] ?? null},
        ${JSON.stringify(r.result.categories)}
      )
    `;
  }
}

export async function insertJob(row: {
  userId: string;
  projectId?: string | null;
  type: string;
  payload?: unknown;
}) {
  const sql = await getSql();
  const id = nid("job");
  await sql`
    insert into jobs (id, user_id, project_id, type, payload_json)
    values (${id}, ${row.userId}, ${row.projectId ?? null}, ${row.type}, ${JSON.stringify(row.payload ?? {})})
  `;
  return { id };
}

export async function getJob(userId: string, jobId: string) {
  const sql = await getSql();
  const rows = await sql<JobRow>`select * from jobs where id = ${jobId} and user_id = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function listJobs(userId: string, projectId?: string) {
  const sql = await getSql();
  if (projectId) {
    return sql<JobRow>`select * from jobs where user_id = ${userId} and project_id = ${projectId} order by created_at desc limit 40`;
  }
  return sql<JobRow>`select * from jobs where user_id = ${userId} order by created_at desc limit 40`;
}

export async function updateJob(
  id: string,
  patch: Partial<{
    state: string;
    progress: number;
    result_json: string;
    provider: string;
    model_name: string;
    model_version: string;
    device: string;
    error_code: string;
    error_message: string;
  }>,
) {
  const sql = await getSql();
  const rows = await sql<JobRow>`select * from jobs where id = ${id} limit 1`;
  const cur = rows[0];
  if (!cur) return;
  await sql`
    update jobs set
      state = ${patch.state ?? cur.state},
      progress = ${patch.progress ?? cur.progress},
      result_json = ${patch.result_json ?? cur.result_json},
      provider = ${patch.provider ?? cur.provider},
      model_name = ${patch.model_name ?? cur.model_name},
      model_version = ${patch.model_version ?? cur.model_version},
      device = ${patch.device ?? cur.device},
      error_code = ${patch.error_code ?? cur.error_code},
      error_message = ${patch.error_message ?? cur.error_message},
      finished_at = ${patch.state === "completed" || patch.state === "failed" || patch.state === "cancelled" ? new Date().toISOString() : null}
    where id = ${id}
  `;
}

export async function insertRevision(row: {
  projectId: string;
  frameId?: string | null;
  action: string;
  source: string;
  caller: string;
  previous: unknown;
  next: unknown;
  timelineId?: string | null;
  startFrame?: number | null;
  endFrame?: number | null;
  status?: string;
}) {
  const sql = await getSql();
  const id = nid("rev");
  await sql`
    insert into revisions (id, project_id, frame_id, action, source, caller, previous_json, new_json, timeline_id, start_frame, end_frame, status)
    values (
      ${id}, ${row.projectId}, ${row.frameId ?? null}, ${row.action}, ${row.source}, ${row.caller},
      ${JSON.stringify(row.previous ?? {})}, ${JSON.stringify(row.next ?? {})},
      ${row.timelineId ?? null}, ${row.startFrame ?? null}, ${row.endFrame ?? null}, ${row.status ?? "open"}
    )
  `;
  return id;
}

export async function listRevisions(projectId: string, frameId?: string) {
  const sql = await getSql();
  if (frameId) {
    return sql<{
      id: string;
      action: string;
      source: string;
      created_at: string;
      frame_id: string | null;
      previous_json: string;
      new_json: string;
      status: string;
    }>`select id, action, source, created_at, frame_id, previous_json, new_json, status from revisions where project_id = ${projectId} and frame_id = ${frameId} order by created_at desc`;
  }
  return sql<{
    id: string;
    action: string;
    source: string;
    created_at: string;
    frame_id: string | null;
    previous_json: string;
    new_json: string;
    status: string;
  }>`select id, action, source, created_at, frame_id, previous_json, new_json, status from revisions where project_id = ${projectId} order by created_at desc limit 80`;
}

export async function getRevision(id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    project_id: string;
    frame_id: string | null;
    action: string;
    previous_json: string;
    new_json: string;
    status: string;
    timeline_id: string | null;
    start_frame: number | null;
    end_frame: number | null;
    created_at: string;
  }>`select * from revisions where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function updateRevisionStatus(id: string, status: string) {
  const sql = await getSql();
  await sql`update revisions set status = ${status} where id = ${id}`;
}

export async function insertRevisionFrame(row: {
  revisionId: string;
  frameId: string;
  frameNumber: number;
  previousHash: string;
}) {
  const sql = await getSql();
  await sql`
    insert into revision_frames (id, revision_id, frame_id, frame_number, previous_hash)
    values (${nid("rvf")}, ${row.revisionId}, ${row.frameId}, ${row.frameNumber}, ${row.previousHash})
  `;
}

export async function insertMcpClient(row: {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  project_scope: string;
  enabled: boolean;
  created_at: string;
}) {
  const sql = await getSql();
  await sql`
    insert into mcp_clients (id, user_id, name, token_hash, token_prefix, scopes, project_scope, enabled, created_at)
    values (${row.id}, ${row.user_id}, ${row.name}, ${row.token_hash}, ${row.token_prefix}, ${row.scopes}, ${row.project_scope}, ${row.enabled}, ${row.created_at})
  `;
}

export async function listMcpClients(userId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    name: string;
    token_prefix: string;
    scopes: string;
    project_scope: string;
    enabled: boolean;
    created_at: string;
  }>`select id, name, token_prefix, scopes, project_scope, enabled, created_at from mcp_clients where user_id = ${userId} order by created_at desc`;
}

export async function getMcpClientByHash(hash: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    user_id: string;
    name: string;
    scopes: string;
    project_scope: string;
    enabled: boolean;
  }>`select id, user_id, name, scopes, project_scope, enabled from mcp_clients where token_hash = ${hash} and enabled = true limit 1`;
  return rows[0] ?? null;
}

export async function insertAudit(row: {
  userId: string;
  clientId?: string | null;
  tool: string;
  caller: string;
  scopeUsed: string;
  args: unknown;
  projectId?: string | null;
  frameRange?: string | null;
  status: string;
  durationMs: number;
  error?: string | null;
  revisionId?: string | null;
}) {
  const sql = await getSql();
  await sql`
    insert into mcp_audit_logs (
      id, user_id, client_id, tool, caller, scope_used, arguments_json, project_id, frame_range, status, duration_ms, error, revision_id
    ) values (
      ${nid("aud")}, ${row.userId}, ${row.clientId ?? null}, ${row.tool}, ${row.caller}, ${row.scopeUsed},
      ${JSON.stringify(row.args ?? {})}, ${row.projectId ?? null}, ${row.frameRange ?? null}, ${row.status},
      ${row.durationMs}, ${row.error ?? null}, ${row.revisionId ?? null}
    )
  `;
}

export async function listAudit(userId: string, limit = 30) {
  const sql = await getSql();
  return sql`select * from mcp_audit_logs where user_id = ${userId} order by created_at desc limit ${limit}`;
}

export async function getAnalysisCache(key: {
  frameHash: string;
  modelName: string;
  modelVersion: string;
  configHash: string;
}) {
  const sql = await getSql();
  const rows = await sql<{ result_json: string }>`
    select result_json from analysis_cache
    where frame_hash = ${key.frameHash} and model_name = ${key.modelName}
      and model_version = ${key.modelVersion} and config_hash = ${key.configHash}
    limit 1
  `;
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].result_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function putAnalysisCache(row: {
  frameHash: string;
  modelName: string;
  modelVersion: string;
  configHash: string;
  result: unknown;
}) {
  const sql = await getSql();
  await sql`
    insert into analysis_cache (id, frame_hash, model_name, model_version, config_hash, result_json)
    values (${nid("cac")}, ${row.frameHash}, ${row.modelName}, ${row.modelVersion}, ${row.configHash}, ${JSON.stringify(row.result)})
    on conflict (frame_hash, model_name, model_version, config_hash)
    do update set result_json = excluded.result_json
  `;
}

export async function listTrackingPoints(projectId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    name: string;
    x: number;
    y: number;
    frame_number: number;
    status: string;
    score: number;
    track_id: string | null;
  }>`select id, name, x, y, frame_number, status, score, track_id from tracking_points where project_id = ${projectId} order by frame_number`;
}

export async function insertTrackingPoint(row: {
  id: string;
  projectId: string;
  name: string;
  x: number;
  y: number;
  frameNumber: number;
  score?: number;
  status?: string;
  trackId?: string;
}) {
  const sql = await getSql();
  await sql`
    insert into tracking_points (id, project_id, name, x, y, frame_number, score, status, track_id)
    values (${row.id}, ${row.projectId}, ${row.name}, ${Math.round(row.x)}, ${Math.round(row.y)}, ${row.frameNumber}, ${row.score ?? 1}, ${row.status ?? "visible"}, ${row.trackId ?? row.name})
  `;
}

export async function deleteTrackingPointsByName(projectId: string, name: string) {
  const sql = await getSql();
  await sql`delete from tracking_points where project_id = ${projectId} and name = ${name}`;
}

export async function deleteTrackEdgesForName(projectId: string, name: string) {
  const sql = await getSql();
  await sql`delete from graph_edges where project_id = ${projectId} and (edge_type = 'TRACKS_TO' or edge_type = 'MOVES_TO') and payload_json like ${"%" + name + "%"}`;
}

export async function listMotion(timelineId: string) {
  const sql = await getSql();
  return sql<{
    frame_number: number;
    magnitude: number;
    direction: number;
    diff: number;
    provider: string;
  }>`select frame_number, magnitude, direction, diff, provider from motion_data where timeline_id = ${timelineId} order by frame_number`;
}

export async function replaceMotionData(
  timelineId: string,
  rows: {
    frameNumber: number;
    magnitude: number;
    direction: number;
    diff: number;
    frameA?: number;
    frameB?: number;
    medianMotion?: number;
    velocityRatio?: number | null;
    directionChangeDeg?: number | null;
    flowAsset?: string;
    regionJson?: string;
  }[],
  provider: string,
) {
  const sql = await getSql();
  await sql`delete from motion_data where timeline_id = ${timelineId}`;
  for (const r of rows) {
    await sql`
      insert into motion_data (
        id, timeline_id, frame_number, magnitude, direction, diff, provider,
        frame_a, frame_b, median_motion, velocity_ratio, direction_change_deg, flow_asset, region_json
      ) values (
        ${nid("mot")}, ${timelineId}, ${r.frameNumber}, ${r.magnitude}, ${r.direction}, ${r.diff}, ${provider},
        ${r.frameA ?? null}, ${r.frameB ?? null}, ${r.medianMotion ?? 0}, ${r.velocityRatio ?? null},
        ${r.directionChangeDeg ?? null}, ${r.flowAsset ?? ""}, ${r.regionJson ?? "null"}
      )
    `;
  }
}

export async function listPoses(timelineId: string) {
  const sql = await getSql();
  return sql<{
    frame_id: string;
    frame_number: number;
    provider: string;
    joints_json: string;
    bbox_json: string;
  }>`
    select p.frame_id, coalesce(p.frame_number, f.frame_number) as frame_number, p.provider, p.joints_json, p.bbox_json
    from poses p join frames f on f.id = p.frame_id
    where f.timeline_id = ${timelineId}
  `;
}

export async function replacePosesForFrames(
  rows: {
    frameId: string;
    frameNumber: number;
    provider: string;
    joints: unknown;
    bbox?: unknown;
    characterId?: string | null;
    modelRunId?: string;
  }[],
) {
  const sql = await getSql();
  for (const r of rows) {
    await sql`delete from poses where frame_id = ${r.frameId}`;
    await sql`
      insert into poses (id, frame_id, provider, joints_json, frame_number, character_id, bbox_json, model_run_id)
      values (
        ${nid("pos")}, ${r.frameId}, ${r.provider}, ${JSON.stringify(r.joints)}, ${r.frameNumber},
        ${r.characterId ?? null}, ${JSON.stringify(r.bbox ?? {})}, ${r.modelRunId ?? r.provider}
      )
    `;
  }
}

export async function upsertKeyframe(row: {
  timelineId: string;
  frameId: string;
  kind: string;
  locked: boolean;
}) {
  const sql = await getSql();
  await sql`
    insert into keyframes (id, timeline_id, frame_id, kind, locked)
    values (${nid("key")}, ${row.timelineId}, ${row.frameId}, ${row.kind}, ${row.locked})
    on conflict (frame_id) do update set kind = excluded.kind, locked = excluded.locked
  `;
}

export async function deleteKeyframeForFrame(frameId: string) {
  const sql = await getSql();
  await sql`delete from keyframes where frame_id = ${frameId}`;
}

export async function listVideos(projectId: string) {
  const sql = await getSql();
  return sql`select * from videos where project_id = ${projectId}`;
}

export async function getVideo(id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    project_id: string;
    filename: string;
    mime_type: string;
    source_path: string;
    status: string;
  }>`select * from videos where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function insertVideo(row: {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  duration_ms?: number;
  width?: number;
  height?: number;
  frame_count?: number;
  content_hash?: string;
  source_path?: string;
  user_id?: string;
  status?: string;
}) {
  const sql = await getSql();
  await sql`
    insert into videos (id, project_id, filename, mime_type, duration_ms, width, height, frame_count, content_hash, source_path, user_id, status)
    values (
      ${row.id}, ${row.project_id}, ${row.filename}, ${row.mime_type}, ${row.duration_ms ?? 0},
      ${row.width ?? 0}, ${row.height ?? 0}, ${row.frame_count ?? 0}, ${row.content_hash ?? ""},
      ${row.source_path ?? ""}, ${row.user_id ?? null}, ${row.status ?? "ready"}
    )
  `;
}

export async function getWorkspaceSession(userId: string, sessionId: string) {
  const sql = await getSql();
  const rows = await sql<WorkspaceSessionRow>`
    select * from workspace_sessions where id = ${sessionId} and user_id = ${userId} limit 1
  `;
  return rows[0] ?? null;
}

export async function upsertWorkspaceSession(row: {
  id: string;
  userId: string;
  projectId: string;
  timelineId?: string | null;
  videoId?: string | null;
  currentFrame?: number | null;
  currentFrameId?: string | null;
  selectedRangeJson?: string;
  selectedFramesJson?: string;
  selectedRegionJson?: string;
  selectedCharacterId?: string | null;
  selectedObjectId?: string | null;
  onionSkinJson?: string;
  overlayJson?: string;
  conversationId?: string | null;
  contextVersion?: number;
  contextJson?: string;
}) {
  const sql = await getSql();
  const existing = await getWorkspaceSession(row.userId, row.id);
  if (!existing) {
    await sql`
      insert into workspace_sessions (
        id, user_id, project_id, timeline_id, video_id, current_frame, current_frame_id,
        selected_range_json, selected_frames_json, selected_region_json, selected_character_id,
        selected_object_id, onion_skin_json, overlay_json, conversation_id, context_version, context_json
      ) values (
        ${row.id}, ${row.userId}, ${row.projectId}, ${row.timelineId ?? null}, ${row.videoId ?? null},
        ${row.currentFrame ?? null}, ${row.currentFrameId ?? null},
        ${row.selectedRangeJson ?? "null"}, ${row.selectedFramesJson ?? "[]"}, ${row.selectedRegionJson ?? "null"},
        ${row.selectedCharacterId ?? null}, ${row.selectedObjectId ?? null},
        ${row.onionSkinJson ?? "{}"}, ${row.overlayJson ?? "{}"}, ${row.conversationId ?? null},
        ${row.contextVersion ?? 0}, ${row.contextJson ?? "{}"}
      )
    `;
    return;
  }
  await sql`
    update workspace_sessions set
      project_id = ${row.projectId},
      timeline_id = ${row.timelineId ?? existing.timeline_id},
      video_id = ${row.videoId ?? existing.video_id},
      current_frame = ${row.currentFrame ?? existing.current_frame},
      current_frame_id = ${row.currentFrameId ?? existing.current_frame_id},
      selected_range_json = ${row.selectedRangeJson ?? existing.selected_range_json},
      selected_frames_json = ${row.selectedFramesJson ?? existing.selected_frames_json},
      selected_region_json = ${row.selectedRegionJson ?? existing.selected_region_json},
      selected_character_id = ${row.selectedCharacterId ?? existing.selected_character_id},
      selected_object_id = ${row.selectedObjectId ?? existing.selected_object_id},
      onion_skin_json = ${row.onionSkinJson ?? existing.onion_skin_json},
      overlay_json = ${row.overlayJson ?? existing.overlay_json},
      conversation_id = ${row.conversationId ?? existing.conversation_id},
      context_version = ${row.contextVersion ?? existing.context_version + 1},
      context_json = ${row.contextJson ?? existing.context_json},
      updated_at = now()
    where id = ${row.id} and user_id = ${row.userId}
  `;
}

export async function insertRegionSelection(row: {
  userId: string;
  sessionId: string;
  frameId: string;
  frameNumber: number;
  selectionType: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const sql = await getSql();
  await sql`
    insert into region_selections (id, user_id, session_id, frame_id, frame_number, selection_type, x, y, width, height)
    values (${nid("rgn")}, ${row.userId}, ${row.sessionId}, ${row.frameId}, ${row.frameNumber}, ${row.selectionType}, ${row.x}, ${row.y}, ${row.width}, ${row.height})
  `;
}

export async function insertConversation(row: {
  id: string;
  userId: string;
  projectId: string;
  timelineId: string | null;
  title: string;
  provider: string;
  mode: string;
  contextLocked: boolean;
  lockedSnapshotJson: string;
  frameStart: number | null;
  frameEnd: number | null;
}) {
  const sql = await getSql();
  await sql`
    insert into conversations (
      id, user_id, project_id, timeline_id, title, provider, mode, context_locked, locked_snapshot_json, frame_start, frame_end
    ) values (
      ${row.id}, ${row.userId}, ${row.projectId}, ${row.timelineId}, ${row.title}, ${row.provider}, ${row.mode},
      ${row.contextLocked}, ${row.lockedSnapshotJson}, ${row.frameStart}, ${row.frameEnd}
    )
  `;
}

export async function getConversation(userId: string, id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    user_id: string;
    project_id: string;
    context_locked: boolean;
    locked_snapshot_json: string;
    provider: string;
    mode: string;
    title: string;
    timeline_id: string | null;
    frame_start: number | null;
    frame_end: number | null;
    created_at: string;
  }>`select * from conversations where id = ${id} and user_id = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function listConversations(userId: string, projectId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    title: string;
    provider: string;
    mode: string;
    created_at: string;
    frame_start: number | null;
    frame_end: number | null;
  }>`select id, title, provider, mode, created_at, frame_start, frame_end from conversations where user_id = ${userId} and project_id = ${projectId} order by updated_at desc`;
}

export async function updateConversation(
  userId: string,
  id: string,
  patch: { contextLocked?: boolean; lockedSnapshotJson?: string },
) {
  const sql = await getSql();
  await sql`
    update conversations set
      context_locked = ${patch.contextLocked ?? false},
      locked_snapshot_json = ${patch.lockedSnapshotJson ?? "null"},
      updated_at = now()
    where id = ${id} and user_id = ${userId}
  `;
}

export async function insertMessage(row: {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshotJson: string;
  contextVersion: number;
}) {
  const sql = await getSql();
  await sql`
    insert into conversation_messages (id, conversation_id, role, content, context_snapshot_json, context_version)
    values (${row.id}, ${row.conversationId}, ${row.role}, ${row.content}, ${row.contextSnapshotJson}, ${row.contextVersion})
  `;
}

export async function listMessages(conversationId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    role: string;
    content: string;
    context_snapshot_json: string;
    context_version: number;
    created_at: string;
  }>`select * from conversation_messages where conversation_id = ${conversationId} order by created_at`;
}

export async function insertToolCallLog(row: {
  conversationId: string;
  messageId: string | null;
  tool: string;
  args: unknown;
  status: string;
  durationMs: number;
  resultSummary: string;
}) {
  const sql = await getSql();
  await sql`
    insert into conversation_tool_calls (id, conversation_id, message_id, tool, arguments_json, status, duration_ms, result_summary)
    values (${nid("tcl")}, ${row.conversationId}, ${row.messageId}, ${row.tool}, ${JSON.stringify(row.args ?? {})}, ${row.status}, ${row.durationMs}, ${row.resultSummary})
  `;
}

export async function insertContextSnapshot(row: {
  userId: string;
  sessionId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  snapshotJson: string;
  contextVersion: number;
}) {
  const sql = await getSql();
  const id = nid("snp");
  await sql`
    insert into context_snapshots (id, user_id, session_id, conversation_id, message_id, snapshot_json, context_version)
    values (${id}, ${row.userId}, ${row.sessionId ?? null}, ${row.conversationId ?? null}, ${row.messageId ?? null}, ${row.snapshotJson}, ${row.contextVersion})
  `;
  return id;
}

export async function conversationCountsByFrame(userId: string, projectId: string) {
  const sql = await getSql();
  return sql<{ frame_start: number; n: number }>`
    select frame_start, count(*)::int as n from conversations
    where user_id = ${userId} and project_id = ${projectId} and frame_start is not null
    group by frame_start
  `;
}

export async function listProblemRanges(timelineId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    start_frame: number;
    end_frame: number;
    peak_frame: number;
    category: string;
    severity: string;
    score: number;
    reason: string;
  }>`select id, start_frame, end_frame, peak_frame, category, severity, score, reason from problem_ranges where timeline_id = ${timelineId} order by start_frame`;
}

export async function replaceProblemRanges(
  timelineId: string,
  ranges: {
    start: number;
    end: number;
    peak_frame: number;
    category: string;
    severity: string;
    score: number;
    reason: string;
  }[],
  snapshotId: string | null,
) {
  const sql = await getSql();
  await sql`delete from problem_ranges where timeline_id = ${timelineId}`;
  for (const r of ranges) {
    await sql`
      insert into problem_ranges (id, timeline_id, start_frame, end_frame, peak_frame, category, severity, score, reason, context_snapshot_id)
      values (${nid("prb")}, ${timelineId}, ${r.start}, ${r.end}, ${r.peak_frame}, ${r.category}, ${r.severity}, ${r.score}, ${r.reason}, ${snapshotId})
    `;
  }
}

export async function insertRepairPlan(row: {
  projectId: string;
  timelineId: string;
  problemStart: number;
  problemEnd: number;
  repairStart: number;
  repairEnd: number;
  provider: string;
  protectedFrames: number[];
  reason: string;
  createdBy: string;
  contextSnapshotId?: string | null;
}) {
  const sql = await getSql();
  const id = nid("rpl");
  await sql`
    insert into repair_plans (
      id, project_id, timeline_id, problem_start, problem_end, repair_start, repair_end,
      provider, protected_frames_json, reason, created_by, context_snapshot_id
    ) values (
      ${id}, ${row.projectId}, ${row.timelineId}, ${row.problemStart}, ${row.problemEnd},
      ${row.repairStart}, ${row.repairEnd}, ${row.provider}, ${JSON.stringify(row.protectedFrames)},
      ${row.reason}, ${row.createdBy}, ${row.contextSnapshotId ?? null}
    )
  `;
  return id;
}

export async function getRepairPlan(id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    project_id: string;
    timeline_id: string;
    problem_start: number;
    problem_end: number;
    repair_start: number;
    repair_end: number;
    provider: string;
    protected_frames_json: string;
    reason: string;
    status: string;
    revision_id: string | null;
  }>`select * from repair_plans where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function updateRepairPlan(id: string, patch: { status?: string; revisionId?: string }) {
  const sql = await getSql();
  const cur = await getRepairPlan(id);
  if (!cur) return;
  await sql`
    update repair_plans set
      status = ${patch.status ?? cur.status},
      revision_id = ${patch.revisionId ?? cur.revision_id}
    where id = ${id}
  `;
}

export async function insertKeyframePair(row: {
  timelineId: string;
  startFrameId: string | null;
  endFrameId: string | null;
  startFrame: number;
  endFrame: number;
  gap: number;
  count: number;
}) {
  const sql = await getSql();
  const id = nid("kfp");
  await sql`
    insert into keyframe_pairs (id, timeline_id, start_frame_id, end_frame_id, start_frame_number, end_frame_number, frame_gap, desired_inbetween_count)
    values (${id}, ${row.timelineId}, ${row.startFrameId}, ${row.endFrameId}, ${row.startFrame}, ${row.endFrame}, ${row.gap}, ${row.count})
  `;
  return id;
}

export async function getKeyframePair(id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    timeline_id: string;
    start_frame_number: number;
    end_frame_number: number;
    frame_gap: number;
    desired_inbetween_count: number;
    status: string;
  }>`select * from keyframe_pairs where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function nextMotionPlanVersion(pairId: string | null, timelineId: string) {
  const sql = await getSql();
  if (pairId) {
    const rows = await sql<{ v: number | null }>`select max(version) as v from motion_plans where pair_id = ${pairId}`;
    return (rows[0]?.v ?? 0) + 1;
  }
  const rows = await sql<{ v: number | null }>`select max(version) as v from motion_plans where timeline_id = ${timelineId}`;
  return (rows[0]?.v ?? 0) + 1;
}

export async function insertMotionPlanRow(row: {
  pairId: string | null;
  timelineId: string;
  version: number;
  planJson: string;
  curve: string;
}) {
  const sql = await getSql();
  const id = nid("mpl");
  await sql`
    insert into motion_plans (id, pair_id, timeline_id, version, plan_json, curve)
    values (${id}, ${row.pairId}, ${row.timelineId}, ${row.version}, ${row.planJson}, ${row.curve})
  `;
  return id;
}

export async function getMotionPlanRow(id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    timeline_id: string;
    version: number;
    plan_json: string;
    curve: string;
  }>`select * from motion_plans where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function insertCandidate(row: {
  projectId: string;
  timelineId: string;
  pairId?: string | null;
  motionPlanId?: string | null;
  jobId?: string | null;
  provider: string;
  model: string;
  quality: string;
  status: string;
  seed?: number | null;
  framesJson: string;
  evaluationJson: string;
}) {
  const sql = await getSql();
  const id = nid("cand");
  await sql`
    insert into candidate_versions (
      id, project_id, timeline_id, pair_id, motion_plan_id, job_id, provider, model, quality, status, seed, frames_json, evaluation_json
    ) values (
      ${id}, ${row.projectId}, ${row.timelineId}, ${row.pairId ?? null}, ${row.motionPlanId ?? null}, ${row.jobId ?? null},
      ${row.provider}, ${row.model}, ${row.quality}, ${row.status}, ${row.seed ?? null}, ${row.framesJson}, ${row.evaluationJson}
    )
  `;
  return id;
}

export async function getCandidate(id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    project_id: string;
    timeline_id: string;
    pair_id: string | null;
    motion_plan_id: string | null;
    job_id: string | null;
    provider: string;
    model: string;
    quality: string;
    status: string;
    seed: number | null;
    frames_json: string;
    evaluation_json: string;
  }>`select * from candidate_versions where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function listCandidates(timelineId: string) {
  const sql = await getSql();
  return sql<{
    id: string;
    status: string;
    provider: string;
    quality: string;
    created_at: string;
  }>`select id, status, provider, quality, created_at from candidate_versions where timeline_id = ${timelineId} order by created_at desc limit 20`;
}

export async function updateCandidate(
  id: string,
  patch: { status?: string; evaluationJson?: string; framesJson?: string },
) {
  const sql = await getSql();
  const current = await getCandidate(id);
  if (!current) return;
  await sql`
    update candidate_versions
    set status = ${patch.status ?? current.status},
        evaluation_json = ${patch.evaluationJson ?? current.evaluation_json},
        frames_json = ${patch.framesJson ?? current.frames_json}
    where id = ${id}
  `;
}

export async function insertGeneratedIssues(
  candidateId: string,
  issues: { frame: number; category: string; severity: string; score: number; reason: string }[],
) {
  const sql = await getSql();
  await sql`delete from generated_frame_issues where candidate_id = ${candidateId}`;
  for (const i of issues) {
    await sql`
      insert into generated_frame_issues (id, candidate_id, frame_number, category, severity, score, reason)
      values (${nid("gfi")}, ${candidateId}, ${i.frame}, ${i.category}, ${i.severity}, ${i.score}, ${i.reason})
    `;
  }
}

export async function listGeneratedIssues(candidateId: string) {
  const sql = await getSql();
  return sql<{
    frame_number: number;
    category: string;
    severity: string;
    score: number;
    reason: string;
  }>`
    select frame_number, category, severity, score, reason
    from generated_frame_issues where candidate_id = ${candidateId} order by frame_number
  `;
}

export async function insertVisualAnnotation(row: {
  id: string;
  userId: string;
  projectId?: string | null;
  sessionId?: string | null;
  frame_id?: string | null;
  frame_number: number;
  type: string;
  coordinates: number[];
  label: string;
  severity?: string | null;
  source: string;
  category?: string | null;
  linked_analysis_id?: string | null;
}) {
  const sql = await getSql();
  await sql`
    insert into visual_annotations (
      id, user_id, project_id, session_id, frame_id, frame_number, type,
      coordinates_json, label, severity, source, category, linked_analysis_id
    ) values (
      ${row.id}, ${row.userId}, ${row.projectId ?? null}, ${row.sessionId ?? null},
      ${row.frame_id ?? null}, ${row.frame_number}, ${row.type},
      ${JSON.stringify(row.coordinates)}, ${row.label}, ${row.severity ?? null},
      ${row.source}, ${row.category ?? null}, ${row.linked_analysis_id ?? null}
    )
  `;
}

export async function listVisualAnnotations(opts: {
  userId: string;
  projectId?: string;
  sessionId?: string;
}) {
  const sql = await getSql();
  if (opts.sessionId) {
    return sql<{
      id: string;
      frame_id: string | null;
      frame_number: number;
      type: string;
      coordinates_json: string;
      label: string;
      severity: string | null;
      source: string;
      category: string | null;
    }>`
      select id, frame_id, frame_number, type, coordinates_json, label, severity, source, category
      from visual_annotations where user_id = ${opts.userId} and session_id = ${opts.sessionId}
      order by created_at desc limit 80
    `;
  }
  if (opts.projectId) {
    return sql<{
      id: string;
      frame_id: string | null;
      frame_number: number;
      type: string;
      coordinates_json: string;
      label: string;
      severity: string | null;
      source: string;
      category: string | null;
    }>`
      select id, frame_id, frame_number, type, coordinates_json, label, severity, source, category
      from visual_annotations where user_id = ${opts.userId} and project_id = ${opts.projectId}
      order by created_at desc limit 80
    `;
  }
  return [];
}
