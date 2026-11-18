import { getLanguageByCode } from '../../shared/catalog';
import type { GlossaryEntry, TonePreset } from '../../shared/types';

export interface PromptBuildOptions {
  sourceLang: string;
  targetLang: string;
  tone: TonePreset;
  customInstruction?: string;
  glossary: GlossaryEntry[];
  useGlossary: boolean;
  chunkText: string;
  previousContext?: {
    sourceTail: string;
    translatedTail: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const TONE_INSTRUCTIONS: Record<TonePreset, string> = {
  natural:
    'Produce a natural, idiomatic translation that reads smoothly to a native speaker while accurately conveying every nuance.',
  formal:
    'Use polite, professional, and formal phrasing suitable for business emails, official reports, or formal documents.',
  technical:
    'Use accurate technical and domain terminology. Keep identifiers, API names, commands, file paths, and code snippets intact.',
  casual:
    'Use a warm, conversational, and approachable everyday tone suitable for chat or informal writing.',
  literal:
    'Stay very close to the source wording and sentence structure with minimal paraphrasing.',
};

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filters glossary entries to only those enabled, compatible with the language pair,
 * and actually appearing in the current text chunk (saves prompt tokens & boosts precision).
 */
export function filterMatchingGlossary(
  glossary: GlossaryEntry[],
  text: string,
  sourceLang: string,
  targetLang: string,
): GlossaryEntry[] {
  if (!glossary.length || !text.trim()) return [];

  const matched: GlossaryEntry[] = [];
  const seen = new Set<string>();

  for (const entry of glossary) {
    if (!entry.enabled) continue;
    const src = entry.sourceTerm.trim();
    const dst = entry.targetTerm.trim();
    if (!src || !dst) continue;

    // Language pair check
    const srcLangOk =
      entry.sourceLang === 'any' || sourceLang === 'auto' || entry.sourceLang === sourceLang;
    const dstLangOk = entry.targetLang === 'any' || entry.targetLang === targetLang;
    if (!srcLangOk || !dstLangOk) continue;

    // Check presence in chunk text: use word boundaries for pure ASCII alphanumeric terms,
    // substring check (case-insensitive) for CJK or symbols.
    const isAsciiWord = /^[A-Za-z0-9][A-Za-z0-9 _-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(src);
    const pattern = isAsciiWord
      ? new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(src)}(?![A-Za-z0-9])`, 'i')
      : new RegExp(escapeRegExp(src), 'i');

    if (pattern.test(text)) {
      const dedupeKey = src.toLowerCase();
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        matched.push(entry);
      }
    }
  }

  return matched;
}

export function buildTranslationMessages(options: PromptBuildOptions): ChatMessage[] {
  const sourceInfo = getLanguageByCode(options.sourceLang);
  const targetInfo = getLanguageByCode(options.targetLang);

  const sourceLabel =
    !sourceInfo || options.sourceLang === 'auto'
      ? 'the automatically detected source language'
      : `${sourceInfo.englishName} (${sourceInfo.label})`;
  const targetLabel = targetInfo
    ? `${targetInfo.englishName} (${targetInfo.label})`
    : options.targetLang;

  const systemParts: string[] = [
    `You are a professional, high-precision translator translating from ${sourceLabel} into ${targetLabel}.`,
    '',
    'STRICT OUTPUT RULES:',
    '1. Output ONLY the translated text. Never include explanations, notes, greetings, labels, or surrounding quotation marks.',
    '2. Preserve the original structure exactly: line breaks, paragraph spacing, Markdown headings/lists/bold/links, inline code (`...`), URLs, numbers, and template placeholders (e.g., {name}, %s, {{key}}).',
    '3. Do not omit or summarize any sentence. Translate the entire target text completely.',
    `4. Style & Tone: ${TONE_INSTRUCTIONS[options.tone]}`,
  ];

  if (options.customInstruction?.trim()) {
    systemParts.push(`5. Additional User Instruction: ${options.customInstruction.trim()}`);
  }

  if (options.useGlossary) {
    const matchedTerms = filterMatchingGlossary(
      options.glossary,
      options.chunkText,
      options.sourceLang,
      options.targetLang,
    );
    if (matchedTerms.length > 0) {
      systemParts.push('', 'MANDATORY GLOSSARY (always apply these exact translations):');
      for (const term of matchedTerms) {
        const noteSuffix = term.note?.trim() ? ` (${term.note.trim()})` : '';
        systemParts.push(`- "${term.sourceTerm}" => "${term.targetTerm}"${noteSuffix}`);
      }
    }
  }

  const systemPrompt = systemParts.join('\n');

  let userPrompt: string;
  if (
    options.previousContext &&
    options.previousContext.sourceTail.trim() &&
    options.previousContext.translatedTail.trim()
  ) {
    userPrompt = [
      'Use the following previous excerpt ONLY as reference context to keep pronouns, terminology, and tone consistent. DO NOT repeat or re-translate the context.',
      '<previous_source>',
      options.previousContext.sourceTail,
      '</previous_source>',
      '<previous_translation>',
      options.previousContext.translatedTail,
      '</previous_translation>',
      '',
      `Translate ONLY the text inside <translate> into ${targetLabel}:`,
      '<translate>',
      options.chunkText,
      '</translate>',
    ].join('\n');
  } else {
    userPrompt = options.chunkText;
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
