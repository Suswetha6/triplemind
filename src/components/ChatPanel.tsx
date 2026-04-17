import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (text: string) => void;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1`}>
      {msg.suggestionRef && (
        <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded-full max-w-xs truncate">
          {msg.suggestionRef.title}
        </span>
      )}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-800 text-gray-200 border border-gray-700'
        }`}
      >
        {msg.content}
      </div>
      <span className="text-xs text-gray-600">
        {new Date(msg.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

export function ChatPanel({ messages, isLoading, onSend }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    onSend(text);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Chat</h2>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-2">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm mt-4">
            Click a suggestion or type a question below.
          </p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex items-center gap-1.5 text-gray-500 text-xs pl-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:300ms]" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask anything about the conversation..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
