export const DEFAULT_DETAILED_ANSWER_PROMPT = `You are an AI meeting assistant. The user clicked a suggestion for more detail.

FULL CONVERSATION TRANSCRIPT:
{fullTranscript}

SUGGESTION:
Title: {title}
Preview: {preview}
Type: {type}

Provide a thorough, well-structured response that:
- Directly addresses the suggestion with depth beyond the preview
- References specific things said in the conversation where relevant
- Is actionable and practical
- Uses markdown formatting (headers, bullets, bold) where it adds clarity
- Is 200-400 words

Be direct. Start with the substance, not "Great question!" filler.`;

export const DEFAULT_CHAT_SYSTEM_PROMPT = `You are an AI meeting assistant with full context of the ongoing conversation.

FULL TRANSCRIPT:
{fullTranscript}

Answer questions clearly and concisely. Reference specific parts of the conversation when relevant. Be direct and actionable. Use markdown when it helps clarity. Do not repeat back the question.`;

export function buildDetailedAnswerMessages(
  fullTranscript: string,
  title: string,
  preview: string,
  type: string,
  customPrompt?: string
) {
  const template = customPrompt || DEFAULT_DETAILED_ANSWER_PROMPT;
  const content = template
    .replace('{fullTranscript}', fullTranscript || '(no transcript yet)')
    .replace('{title}', title)
    .replace('{preview}', preview)
    .replace('{type}', type);
  return [{ role: 'user' as const, content }];
}

export function buildChatMessages(
  fullTranscript: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  customSystemPrompt?: string
) {
  const systemTemplate = customSystemPrompt || DEFAULT_CHAT_SYSTEM_PROMPT;
  const systemContent = systemTemplate.replace(
    '{fullTranscript}',
    fullTranscript || '(no transcript yet)'
  );
  return [
    { role: 'system' as const, content: systemContent },
    ...history,
    { role: 'user' as const, content: userMessage },
  ];
}
