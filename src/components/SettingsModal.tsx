import { useState } from 'react';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

type Tab = 'api' | 'prompts' | 'params';

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>({ ...settings });
  const [tab, setTab] = useState<Tab>('api');

  const set = (key: keyof Settings, value: string | number) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const tabs: { key: Tab; label: string }[] = [
    { key: 'api', label: 'API & Models' },
    { key: 'prompts', label: 'Prompts' },
    { key: 'params', label: 'Parameters' },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="flex border-b border-gray-700">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'text-indigo-400 border-b-2 border-indigo-400'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'api' && (
            <>
              <Field label="Groq API Key" hint="Paste your key — never stored on a server">
                <input
                  type="password"
                  value={draft.groqApiKey}
                  onChange={(e) => set('groqApiKey', e.target.value)}
                  placeholder="gsk_..."
                  className={inputCls}
                />
              </Field>
              <Field label="Suggestion / Chat Model">
                <input
                  value={draft.suggestionModel}
                  onChange={(e) => set('suggestionModel', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Transcription Model">
                <input
                  value={draft.transcriptionModel}
                  onChange={(e) => set('transcriptionModel', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {tab === 'prompts' && (
            <>
              <Field label="Live Suggestions Prompt" hint="Use {fullTranscript}, {recentTranscript}, {contextChars}">
                <textarea
                  value={draft.suggestionPrompt}
                  onChange={(e) => set('suggestionPrompt', e.target.value)}
                  rows={10}
                  className={`${inputCls} font-mono text-xs`}
                />
              </Field>
              <Field label="Detailed Answer Prompt" hint="Use {fullTranscript}, {title}, {preview}, {type}">
                <textarea
                  value={draft.detailedAnswerPrompt}
                  onChange={(e) => set('detailedAnswerPrompt', e.target.value)}
                  rows={8}
                  className={`${inputCls} font-mono text-xs`}
                />
              </Field>
              <Field label="Chat System Prompt" hint="Use {fullTranscript}">
                <textarea
                  value={draft.chatSystemPrompt}
                  onChange={(e) => set('chatSystemPrompt', e.target.value)}
                  rows={6}
                  className={`${inputCls} font-mono text-xs`}
                />
              </Field>
            </>
          )}

          {tab === 'params' && (
            <>
              <Field label="Suggestion Context (chars)" hint="Recent transcript chars passed for suggestions">
                <input
                  type="number"
                  value={draft.suggestionContextChars}
                  onChange={(e) => set('suggestionContextChars', Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
              <Field label="Detailed Answer Context (chars)" hint="Max transcript chars for expanded answers">
                <input
                  type="number"
                  value={draft.detailedAnswerContextChars}
                  onChange={(e) => set('detailedAnswerContextChars', Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
              <Field label="Auto-refresh Interval (ms)" hint="How often suggestions refresh (default 30000)">
                <input
                  type="number"
                  value={draft.refreshIntervalMs}
                  onChange={(e) => set('refreshIntervalMs', Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(draft); onClose(); }}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}
