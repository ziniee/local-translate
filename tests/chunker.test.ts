import { describe, expect, it } from 'vitest';
import { extractTrailingContext, splitIntoChunks } from '../src/main/translation/chunker';

describe('splitIntoChunks', () => {
  it('returns empty array for empty input', () => {
    expect(splitIntoChunks('')).toEqual([]);
  });

  it('keeps short text as a single chunk with lossless reassembly', () => {
    const input = 'Hello world.\n\nThis is a short paragraph.';
    const chunks = splitIntoChunks(input, { maxChunkChars: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].isCodeBlock).toBe(false);
    expect(chunks.map((c) => c.leadingSeparator + c.text).join('')).toBe(input);
  });

  it('splits multi-paragraph long text without losing any text or separators', () => {
    const p1 = 'First paragraph sentence one. '.repeat(25).trim();
    const p2 = 'Second paragraph sentence two. '.repeat(25).trim();
    const p3 = 'Third paragraph sentence three. '.repeat(25).trim();
    const input = `${p1}\n\n${p2}\n\n${p3}`;

    const chunks = splitIntoChunks(input, { maxChunkChars: 500 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(520);
      expect(chunk.isCodeBlock).toBe(false);
    }

    const reassembled = chunks.map((c) => c.leadingSeparator + c.text).join('');
    expect(reassembled).toBe(input);
  });

  it('preserves fenced markdown code blocks verbatim when preserveCodeBlocks is true', () => {
    const input = [
      '# Architecture Overview',
      '',
      'Here is a sample configuration:',
      '```ts',
      'const port = 8080;',
      'console.log("do not translate me");',
      '```',
      '',
      'And here is the closing explanation.',
    ].join('\n');

    const chunks = splitIntoChunks(input, { maxChunkChars: 1000, preserveCodeBlocks: true });
    const codeChunks = chunks.filter((c) => c.isCodeBlock);
    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0].text).toContain('console.log("do not translate me");');

    const reassembled = chunks.map((c) => c.leadingSeparator + c.text).join('');
    expect(reassembled).toBe(input);
  });

  it('splits oversized single paragraph along sentence boundaries', () => {
    const sentences = Array.from(
      { length: 20 },
      (_, i) => `Sentence number ${i + 1} explains local LLM translation in detail.`,
    ).join(' ');

    const chunks = splitIntoChunks(sentences, { maxChunkChars: 250 });
    expect(chunks.length).toBeGreaterThan(3);
    const reassembled = chunks.map((c) => c.leadingSeparator + c.text).join('');
    expect(reassembled).toBe(sentences);
  });
});

describe('extractTrailingContext', () => {
  it('returns full text if shorter than maxChars', () => {
    expect(extractTrailingContext('Short sentence.', 200)).toBe('Short sentence.');
  });

  it('extracts a clean trailing slice near sentence boundary for long text', () => {
    const text =
      'First long sentence about hardware acceleration. Second sentence about CUDA and Vulkan fallback. Final sentence about RTX 3060 performance.';
    const tail = extractTrailingContext(text, 90);
    expect(tail.length).toBeLessThanOrEqual(90);
    expect(tail).toContain('RTX 3060 performance.');
  });
});
