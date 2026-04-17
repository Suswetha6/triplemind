export type SuggestionType = 'answer' | 'question' | 'fact_check' | 'talking_point' | 'clarification';

export interface Suggestion {
  id: string;
  title: string;
  preview: string;
  type: SuggestionType;
}

export interface SuggestionBatch {
  id: string;
  suggestions: Suggestion[];
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  suggestionRef?: Pick<Suggestion, 'title' | 'type'>;
}

export interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: number;
}

export interface Settings {
  groqApiKey: string;
  suggestionModel: string;
  transcriptionModel: string;
  suggestionPrompt: string;
  detailedAnswerPrompt: string;
  chatSystemPrompt: string;
  suggestionContextChars: number;
  detailedAnswerContextChars: number;
  refreshIntervalMs: number;
}
