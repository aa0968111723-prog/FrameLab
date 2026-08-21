/** Named ConversationContextBuilder entry (spec §29). Domain lives in conversation.ts. */

export {
  ConversationContextBuilder,
  buildConversationPrompt,
  buildFallbackAskReply,
  formatPromptForProvider,
  conversationTitleFromContext,
  parseSuggestedActions,
  ASK_MCP_TOOLS,
  FORBIDDEN_ASK_TOOLS,
  isAskToolAllowed,
} from "@/lib/domain/conversation";
