import { describe, expect, it } from 'vitest';
import {
  buildTranslationMessages,
  filterMatchingGlossary,
} from '../src/main/translation/promptBuilder';
import type { GlossaryEntry } from '../src/shared/types';

const SAMPLE_GLOSSARY: GlossaryEntry[] = [
  {
    id: '1',
    sourceTerm: 'sidecar',
    targetTerm: '사이드카',
    sourceLang: 'en',
    targetLang: 'ko',
    enabled: true,
    note: '프로세스 격리 패턴',
  },
  {
    id: '2',
    sourceTerm: 'quantization',
    targetTerm: '양자화',
    sourceLang: 'any',
    targetLang: 'ko',
    enabled: true,
  },
  {
    id: '3',
    sourceTerm: 'disabledTerm',
    targetTerm: '비활성',
    sourceLang: 'any',
    targetLang: 'any',
    enabled: false,
  },
  {
    id: '4',
    sourceTerm: 'token',
    targetTerm: 'トークン',
    sourceLang: 'en',
    targetLang: 'ja',
    enabled: true,
  },
];

describe('filterMatchingGlossary', () => {
  it('injects only enabled, language-matching terms that appear in text', () => {
    const text = 'The sidecar process runs GGUF quantization locally with disabledTerm and token.';
    const matched = filterMatchingGlossary(SAMPLE_GLOSSARY, text, 'en', 'ko');
    expect(matched.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('respects ASCII word boundaries so substrings do not false-match', () => {
    const glossary: GlossaryEntry[] = [
      {
        id: 'cat',
        sourceTerm: 'cat',
        targetTerm: '고양이',
        sourceLang: 'en',
        targetLang: 'ko',
        enabled: true,
      },
    ];
    expect(filterMatchingGlossary(glossary, 'catalog category', 'en', 'ko')).toEqual([]);
    expect(filterMatchingGlossary(glossary, 'A black cat slept.', 'en', 'ko')).toHaveLength(1);
  });
});

describe('buildTranslationMessages', () => {
  it('enforces translation-only rules, tone, custom instruction, and matched glossary', () => {
    const messages = buildTranslationMessages({
      sourceLang: 'en',
      targetLang: 'ko',
      tone: 'technical',
      customInstruction: '해요체로 통일해줘',
      glossary: SAMPLE_GLOSSARY,
      useGlossary: true,
      chunkText: 'Use a sidecar engine for offline inference.',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Output ONLY the translated text');
    expect(messages[0].content).toContain('해요체로 통일해줘');
    expect(messages[0].content).toContain('"sidecar" => "사이드카"');
    expect(messages[0].content).not.toContain('quantization');
    expect(messages[1].content).toBe('Use a sidecar engine for offline inference.');
  });

  it('wraps continuation chunk with previous context tags', () => {
    const messages = buildTranslationMessages({
      sourceLang: 'en',
      targetLang: 'ko',
      tone: 'natural',
      glossary: [],
      useGlossary: false,
      chunkText: 'It runs completely offline.',
      previousContext: {
        sourceTail: 'LocalTranslate embeds llama-server.',
        translatedTail: 'LocalTranslate는 llama-server를 내장합니다.',
      },
    });

    expect(messages[1].content).toContain('<previous_source>');
    expect(messages[1].content).toContain('<previous_translation>');
    expect(messages[1].content).toContain('<translate>\nIt runs completely offline.\n</translate>');
  });
});
