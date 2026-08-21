/**
 * The single ownership + scope gate for every command path.
 *
 * Two checks have to happen together and neither is optional:
 *
 *   1. `getProject(userId, id)` proves the *caller* owns the project.
 *   2. `assertProjectScope` proves the *token* is allowed to touch that
 *      project — an MCP client key may be scoped to a subset of the user's
 *      own projects.
 *
 * Call sites used to inline these by hand, and both halves went wrong:
 * several tools called `repo.getProject(...)` and threw the result away
 * (an unread result is not a check — those paths read and wrote across
 * tenants), and every module outside execute.ts omitted the scope half, so a
 * token scoped to project A could still act on project B of the same user.
 *
 * Route ownership through these helpers rather than re-inlining the pair.
 */
import { fail } from "@/lib/domain/errors";
import { assertProjectScope } from "@/lib/domain/permissions";
import * as repo from "@/lib/framelab/repo";

/**
 * Structural subset of `CommandContext`. Declared here rather than imported so
 * this module never participates in a cycle with execute.ts.
 */
export type OwnerContext = { userId: string; projectScope?: string };

/** Assert the caller owns `projectId` and the token is scoped to it. */
export async function ownProject(ctx: OwnerContext, projectId: string) {
  const project = await repo.getProject(ctx.userId, projectId);
  if (!project) fail("PROJECT_NOT_FOUND", "Project not found", 404);
  assertProjectScope(ctx.projectScope, projectId);
  return project;
}

/** Resolve a timeline and assert its project passes {@link ownProject}. */
export async function ownTimeline(ctx: OwnerContext, timelineId: string) {
  const timeline = await repo.getTimeline(timelineId);
  if (!timeline) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  await ownProject(ctx, timeline.project_id);
  return timeline;
}

/** Resolve a frame and assert its timeline's project passes {@link ownProject}. */
export async function ownFrame(ctx: OwnerContext, frameId: string) {
  const frame = await repo.getFrame(frameId);
  if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  await ownTimeline(ctx, frame.timeline_id);
  return frame;
}

/**
 * Resolve a character and assert its project passes {@link ownProject}.
 *
 * `repo.getCharacter` / `repo.characterTrack` are keyed by character id alone,
 * so the read tools built on them used to answer for any tenant's character.
 */
export async function ownCharacter(ctx: OwnerContext, characterId: string) {
  const character = await repo.getCharacter(characterId);
  if (!character) fail("FRAME_NOT_FOUND", "Character not found", 404);
  await ownProject(ctx, character.project_id);
  return character;
}

/** Resolve an object and assert its project passes {@link ownProject}. */
export async function ownObject(ctx: OwnerContext, objectId: string) {
  const object = await repo.getObject(objectId);
  if (!object) fail("FRAME_NOT_FOUND", "Object not found", 404);
  await ownProject(ctx, object.project_id);
  return object;
}
