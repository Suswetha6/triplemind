import { useEffect, useRef } from 'react';
import type { TranscriptChunk } from '../types';

interface Props {
  chunks: TranscriptChunk[];
  isRecording: boolean;
  onToggleRecording: () => void;
}

export function TranscriptPanel({ chunks, isRecording, onToggleRecording }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chunks]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Transcript</h2>
        <button
          onClick={onToggleRecording}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            isRecording
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
          }`}
        >
          {isRecording ? (
            <>
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              Stop
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-white" />
              Start
            </>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {chunks.length === 0 ? (
          <p className="text-gray-500 text-sm mt-4">
            Press Start to begin recording. Transcript will appear here in chunks.
          </p>
        ) : (
          chunks.map((chunk) => (
            <div key={chunk.id} className="group">
              <span className="text-xs text-gray-600 block mb-1">
                {new Date(chunk.timestamp).toLocaleTimeString()}
              </span>
              <p className="text-gray-200 text-sm leading-relaxed">{chunk.text}</p>
            </div>
          ))
        )}
        {isRecording && chunks.length > 0 && (
          <div className="flex items-center gap-2 text-gray-500 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            Recording...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
