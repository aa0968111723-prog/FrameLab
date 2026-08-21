/** Spec §29 path. Implementation lives in commands/context-tools (executeTool only). */

export {
  getCurrentContext,
  getCurrentFrame,
  getSelectedFrames,
  getSelectedFrameRange,
  getSelectedRegion,
  getCurrentCharacter,
  getCurrentObject,
  getFrameNeighborsForSession,
  analyzeSelection,
  analyzeMotionContext,
  readSessionContextResource,
  readConversationResource,
  contextFromSession,
} from "@/lib/commands/context-tools";
