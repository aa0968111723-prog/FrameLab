/**
 * Regression guard for the cross-tenant defects fixed in the hardening pass.
 *
 * These paths need a live database to exercise end to end, so instead of
 * pretending to integration-test them this suite locks the *invariant* that
 * made them exploitable: ownership must go through src/lib/commands/ownership.ts
 * and nowhere else. Every bug in this class looked the same in source form —
 * a bare `repo.getProject(ctx.userId, ...)` whose result was dropped, or a
 * resource fetched by a caller-supplied id with no owner lookup at all.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const COMMANDS_DIR = path.join(process.cwd(), "src", "lib", "commands");
const read = (f: string) => fs.readFileSync(path.join(COMMANDS_DIR, f), "utf8");
const commandFiles = fs
  .readdirSync(COMMANDS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("ownership gate", () => {
  it("has command modules to check", () => {
    assert.ok(commandFiles.length >= 4, `expected command modules, saw ${commandFiles.length}`);
    assert.ok(commandFiles.includes("ownership.ts"));
  });

  it("routes every project ownership check through ownership.ts", () => {
    // ownership.ts is the one place allowed to call getProject directly.
    const offenders = commandFiles
      .filter((f) => f !== "ownership.ts")
      .filter((f) => /repo\.getProject\s*\(/.test(read(f)));
    assert.deepEqual(
      offenders,
      [],
      `these modules call repo.getProject directly instead of ownProject(): ${offenders.join(", ")}. ` +
        "Inlining the check is how the discarded-result cross-tenant reads happened.",
    );
  });

  it("pairs the owner lookup with the token scope check in one place", () => {
    const gate = read("ownership.ts");
    assert.match(gate, /repo\.getProject\(ctx\.userId, projectId\)/);
    assert.match(gate, /assertProjectScope\(ctx\.projectScope, projectId\)/);
    assert.match(gate, /if \(!project\) fail\("PROJECT_NOT_FOUND"/);
  });

  it("never discards the result of an ownership helper", () => {
    // `await ownProject(...)` as a statement is fine (it throws on failure);
    // what must never reappear is a *lookup* whose falsy result goes unread.
    for (const f of commandFiles) {
      const src = read(f);
      assert.doesNotMatch(
        src,
        /^\s*await repo\.get(?:Project|Character|Object|Timeline)\(/m,
        `${f} performs a bare resource lookup as a statement — an unread result is not a check`,
      );
    }
  });

  it("gates character and object reads by owner, not by bare id", () => {
    const exec = read("execute.ts");
    for (const tool of ["get_character", "get_character_track", "get_object", "get_object_track"]) {
      const idx = exec.indexOf(`case "${tool}"`);
      assert.ok(idx > 0, `${tool} case not found`);
      const body = exec.slice(idx, idx + 260);
      assert.match(
        body,
        /own(Character|Object)\(ctx,/,
        `${tool} must resolve through ownCharacter/ownObject — repo.getCharacter and ` +
          "repo.characterTrack are keyed by id alone and answer for any tenant",
      );
    }
  });

  it("verifies the character being assigned belongs to the caller", () => {
    const exec = read("execute.ts");
    const idx = exec.indexOf('case "assign_character"');
    assert.ok(idx > 0);
    const body = exec.slice(idx, idx + 320);
    assert.match(
      body,
      /ownCharacter\(ctx,/,
      "assign_character must prove the character is the caller's: character_id FKs to " +
        "characters(id), so another tenant's id is a valid target and pollutes their track",
    );
  });
});

describe("timeline binding", () => {
  const api = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "framelab", "api.ts"),
    "utf8",
  );

  it("never lists frames by a caller-supplied timeline id alone", () => {
    assert.doesNotMatch(
      api,
      /listFramesFull\(data\.timelineId\)/,
      "checking ownership of projectId and then querying by an unvalidated timelineId " +
        "is a confused deputy: it dumped every frame JPEG of any timeline",
    );
    assert.match(api, /timeline\.project_id !== project\.id/);
  });

  it("binds a workspace session's timeline to its project", () => {
    // Session tools trust session.timeline_id, so an unvalidated id stored here
    // becomes a cross-tenant read downstream.
    const occurrences = api.split("Timeline does not belong to this project").length - 1;
    assert.equal(
      occurrences,
      2,
      "both openWorkspaceSession and syncWorkspaceSession must validate the timeline",
    );
  });
});
