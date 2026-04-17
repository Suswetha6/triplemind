import type { SuggestionBatch, Suggestion } from '../types';
import { SuggestionCard } from './SuggestionCard';

interface Props {
  batches: SuggestionBatch[];
  isLoading: boolean;
  onRefresh: () => void;
  onSuggestionClick: (s: Suggestion) => void;
}

export function SuggestionsPanel({ batches, isLoading, onRefresh, onSuggestionClick }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Suggestions
        </h2>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <>
              <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        {batches.length === 0 && !isLoading && (
          <p className="text-gray-500 text-sm mt-4">
            Suggestions will appear automatically while recording.
          </p>
        )}

        {isLoading && batches.length === 0 && (
          <div className="space-y-3 mt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 animate-pulse">
                <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-700 rounded w-full mb-1" />
                <div className="h-3 bg-gray-700 rounded w-5/6" />
              </div>
            ))}
          </div>
        )}

        {batches.map((batch, batchIndex) => (
          <div key={batch.id}>
            <div className="flex items-center gap-2 mb-2">
              {batchIndex === 0 && (
                <span className="text-xs font-medium text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded-full">
                  Latest
                </span>
              )}
              <span className="text-xs text-gray-600">
                {new Date(batch.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="space-y-2">
              {batch.suggestions.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} onClick={onSuggestionClick} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
