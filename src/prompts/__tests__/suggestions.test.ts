import { describe, expect, it } from 'vitest';
import { DEFAULT_SUGGESTION_PROMPT, buildSuggestionsPrompt } from '../suggestions';

describe('buildSuggestionsPrompt', () => {
  it('substitutes all three placeholders', () => {
    const prompt = buildSuggestionsPrompt('FULL', 'RECENT', 3000);
    expect(prompt).toContain('FULL');
    expect(prompt).toContain('RECENT');
    expect(prompt).toContain('3000');
    expect(prompt).not.toContain('{fullTranscript}');
    expect(prompt).not.toContain('{recentTranscript}');
    expect(prompt).not.toContain('{contextChars}');
  });

  it('falls back to placeholder copy on an empty transcript', () => {
    const prompt = buildSuggestionsPrompt('', '', 3000);
    expect(prompt).toContain('(no transcript yet)');
    expect(prompt).toContain('(no recent context)');
  });

  it('honours a user-supplied template from Settings', () => {
    const prompt = buildSuggestionsPrompt('F', 'R', 10, 'only {recentTranscript} matters');
    expect(prompt).toBe('only R matters');
  });

  it('keeps the rules the suggestion quality depends on', () => {
    expect(DEFAULT_SUGGESTION_PROMPT).toContain('Never return 3 of the same type');
    expect(DEFAULT_SUGGESTION_PROMPT).toContain('standalone value');
  });
});
