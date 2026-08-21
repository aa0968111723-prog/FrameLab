/** MCP Context Bridge — ASK-safe workspace tools. Never reads React state. */

import type { CommandContext } from "@/lib/commands/execute";
import {
  analyzeMotionContext,
  analyzeSelection,
  getCurrentCharacter,
  getCurrentContext,
  getCurrentFrame,
  getCurrentObject,
  getFrameNeighborsForSession,
  getSelectedFrameRange,
  getSelectedFrames,
  getSelectedRegion,
  readConversationResource,
  readSessionContextResource,
} from "@/lib/commands/context-tools";

export const MCP_CONTEXT_TOOLS = [
  "get_current_context",
  "get_current_frame",
  "get_selected_frames",
  "get_selected_frame_range",
  "get_selected_range",
  "get_selected_region",
  "get_current_character",
  "get_current_object",
  "get_frame_neighbors",
  "analyze_selection",
  "analyze_motion_context",
] as const;

export const McpContextBridge = {
  get_current_context: getCurrentContext,
  get_current_frame: getCurrentFrame,
  get_selected_frames: getSelectedFrames,
  get_selected_frame_range: getSelectedFrameRange,
  get_selected_range: getSelectedFrameRange,
  get_selected_region: getSelectedRegion,
  get_current_character: getCurrentCharacter,
  get_current_object: getCurrentObject,
  get_frame_neighbors: getFrameNeighborsForSession,
  analyze_selection: analyzeSelection,
  analyze_motion_context: analyzeMotionContext,
  read_session: readSessionContextResource,
  read_conversation: readConversationResource,
};

export async function callContextBridge(
  ctx: CommandContext,
  tool: (typeof MCP_CONTEXT_TOOLS)[number],
  args: Record<string, unknown>,
) {
  switch (tool) {
    case "get_current_context":
      return getCurrentContext(ctx, args);
    case "get_current_frame":
      return getCurrentFrame(ctx, args);
    case "get_selected_frames":
      return getSelectedFrames(ctx, args);
    case "get_selected_frame_range":
    case "get_selected_range":
      return getSelectedFrameRange(ctx, args);
    case "get_selected_region":
      return getSelectedRegion(ctx, args);
    case "get_current_character":
      return getCurrentCharacter(ctx, args);
    case "get_current_object":
      return getCurrentObject(ctx, args);
    case "get_frame_neighbors":
      return getFrameNeighborsForSession(ctx, args);
    case "analyze_selection":
      return analyzeSelection(ctx, args);
    case "analyze_motion_context":
      return analyzeMotionContext(ctx, args);
    default:
      return { ok: false, code: "MCP_TOOL_ERROR", error: `Unknown context tool ${tool}` };
  }
}
