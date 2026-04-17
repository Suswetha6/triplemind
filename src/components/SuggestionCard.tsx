import type { Suggestion, SuggestionType } from '../types';

const TYPE_META: Record<SuggestionType, { label: string; color: string }> = {
  answer: { label: 'Answer', color: 'bg-emerald-900/50 text-emerald-300 border-emerald-800' },
  question: { label: 'Question', color: 'bg-blue-900/50 text-blue-300 border-blue-800' },
  fact_check: { label: 'Fact Check', color: 'bg-amber-900/50 text-amber-300 border-amber-800' },
  talking_point: { label: 'Talking Point', color: 'bg-purple-900/50 text-purple-300 border-purple-800' },
  clarification: { label: 'Clarification', color: 'bg-slate-800/80 text-slate-300 border-slate-700' },
};

interface Props {
  suggestion: Suggestion;
  onClick: (s: Suggestion) => void;
}

export function SuggestionCard({ suggestion, onClick }: Props) {
  const meta = TYPE_META[suggestion.type];

  return (
    <button
      onClick={() => onClick(suggestion)}
      className="w-full text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-lg p-3 transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-gray-100 text-sm font-medium leading-snug group-hover:text-white">
          {suggestion.title}
        </span>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${meta.color}`}>
          {meta.label}
        </span>
      </div>
      <p className="text-gray-400 text-xs leading-relaxed">{suggestion.preview}</p>
    </button>
  );
}
