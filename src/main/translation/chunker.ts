export interface TextChunk {
  index: number;
  text: string;
  /** Separator that immediately preceded this chunk (preserved on join) */
  leadingSeparator: string;
  /** When true, this chunk is a fenced code block that should be passed through verbatim */
  isCodeBlock: boolean;
}

interface RawSegment {
  text: string;
  isCodeBlock: boolean;
}

/**
 * Splits input into alternating prose and fenced code block segments (``` or ~~~).
 */
function splitByCodeFences(input: string): RawSegment[] {
  const lines = input.split('\n');
  const segments: RawSegment[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let fenceMarker = '';

  const flush = (isCodeBlock: boolean) => {
    if (buffer.length > 0) {
      segments.push({ text: buffer.join('\n'), isCodeBlock });
      buffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inCode) {
      const openMatch = trimmed.match(/^(`{3,}|~{3,})/);
      if (openMatch) {
        flush(false);
        inCode = true;
        fenceMarker = openMatch[1][0].repeat(openMatch[1].length);
        buffer.push(line);
      } else {
        buffer.push(line);
      }
    } else {
      buffer.push(line);
      const closeRe = new RegExp(`^${fenceMarker[0]}{${fenceMarker.length},}\\s*$`);
      if (closeRe.test(trimmed)) {
        flush(true);
        inCode = false;
        fenceMarker = '';
      }
    }
  }

  flush(inCode);
  return segments;
}

/**
 * Splits a single oversized paragraph along sentence boundaries (English, Korean, Japanese, Chinese)
 * or falls back to line / whitespace splits while preserving exact separators.
 */
function splitLargeParagraph(
  paragraph: string,
  maxChunkChars: number,
): Array<{ text: string; sep: string }> {
  if (paragraph.length <= maxChunkChars) {
    return [{ text: paragraph, sep: '' }];
  }

  // Split keeping delimiters (punctuation + whitespace or single newline)
  const tokens = paragraph.split(/((?<=[.!?。！？])\s+|\n)/);
  const results: Array<{ text: string; sep: string }> = [];
  let current = '';
  let pendingSep = '';

  const pushCurrent = () => {
    if (current.length > 0) {
      results.push({ text: current, sep: pendingSep });
      current = '';
      pendingSep = '';
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const part = tokens[i];
    if (!part) continue;

    // Even indices are content, odd indices are captured separators
    if (i % 2 === 1) {
      if (current.length > 0 && current.length + part.length <= maxChunkChars) {
        current += part;
      } else {
        pushCurrent();
        pendingSep = part;
      }
      continue;
    }

    if (part.length > maxChunkChars) {
      // Hard-split oversized sentence at whitespace if possible
      pushCurrent();
      let remaining = part;
      let firstSub = true;
      while (remaining.length > maxChunkChars) {
        let cut = remaining.lastIndexOf(' ', maxChunkChars);
        if (cut < Math.floor(maxChunkChars * 0.5)) {
          cut = maxChunkChars;
        }
        const slice = remaining.slice(0, cut);
        const sepForThis = firstSub ? pendingSep : ' ';
        results.push({ text: slice, sep: sepForThis });
        pendingSep = '';
        firstSub = false;
        remaining = remaining.slice(cut).replace(/^ /, '');
      }
      if (remaining.length > 0) {
        current = remaining;
        pendingSep = firstSub ? pendingSep : ' ';
      }
    } else if (current.length === 0) {
      current = part;
    } else if (current.length + part.length <= maxChunkChars) {
      current += part;
    } else {
      pushCurrent();
      current = part;
    }
  }

  pushCurrent();
  return results;
}

/**
 * Splits a document into translation-friendly chunks while protecting fenced code blocks
 * and preserving exact paragraph/line separators for lossless reassembly.
 */
export function splitIntoChunks(
  input: string,
  options: { maxChunkChars?: number; preserveCodeBlocks?: boolean } = {},
): TextChunk[] {
  const maxChunkChars = Math.max(200, options.maxChunkChars ?? 1000);
  const preserveCodeBlocks = options.preserveCodeBlocks ?? true;

  if (!input) return [];

  const normalized = input.replace(/\r\n/g, '\n');
  const rawSegments = preserveCodeBlocks
    ? splitByCodeFences(normalized)
    : [{ text: normalized, isCodeBlock: false }];

  const chunks: TextChunk[] = [];
  let nextLeadingSep = '';

  for (let segIdx = 0; segIdx < rawSegments.length; segIdx++) {
    const seg = rawSegments[segIdx];
    const segSep = segIdx === 0 ? '' : '\n';

    if (seg.isCodeBlock) {
      chunks.push({
        index: chunks.length,
        text: seg.text,
        leadingSeparator: nextLeadingSep + segSep,
        isCodeBlock: true,
      });
      nextLeadingSep = '';
      continue;
    }

    // Split prose segment by blank lines while capturing the exact blank-line separators
    const paraParts = seg.text.split(/(\n{2,})/);
    let currentText = '';
    let currentSep = nextLeadingSep + segSep;
    nextLeadingSep = '';

    const flushProse = () => {
      if (currentText.length > 0) {
        chunks.push({
          index: chunks.length,
          text: currentText,
          leadingSeparator: currentSep,
          isCodeBlock: false,
        });
        currentText = '';
        currentSep = '';
      }
    };

    for (let i = 0; i < paraParts.length; i++) {
      const piece = paraParts[i];
      if (piece === '') continue;

      if (i % 2 === 1) {
        // Blank-line separator
        if (currentText.length > 0) {
          // Check next paragraph size to decide whether to pack into current chunk
          const nextPara = paraParts[i + 1] ?? '';
          if (
            nextPara.length > 0 &&
            currentText.length + piece.length + nextPara.length <= maxChunkChars
          ) {
            currentText += piece;
          } else {
            flushProse();
            currentSep = piece;
          }
        } else {
          currentSep += piece;
        }
        continue;
      }

      if (piece.length > maxChunkChars) {
        flushProse();
        const subChunks = splitLargeParagraph(piece, maxChunkChars);
        for (let s = 0; s < subChunks.length; s++) {
          chunks.push({
            index: chunks.length,
            text: subChunks[s].text,
            leadingSeparator: s === 0 ? currentSep + subChunks[s].sep : subChunks[s].sep,
            isCodeBlock: false,
          });
          currentSep = '';
        }
      } else if (currentText.length === 0) {
        currentText = piece;
      } else if (currentText.length + piece.length <= maxChunkChars) {
        currentText += piece;
      } else {
        flushProse();
        currentText = piece;
      }
    }

    flushProse();
    if (currentSep) {
      nextLeadingSep = currentSep;
    }
  }

  // If trailing whitespace/newlines remain, attach to last chunk
  if (nextLeadingSep && chunks.length > 0) {
    chunks[chunks.length - 1].text += nextLeadingSep;
  }

  return chunks;
}

/**
 * Extracts the trailing 1-2 sentences (up to maxChars) from a chunk to pass as sliding context
 * for pronoun, terminology, and tone consistency in the next chunk.
 */
export function extractTrailingContext(text: string, maxChars = 220): string {
  const cleaned = text.trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;

  const tail = cleaned.slice(-maxChars);
  // Try to start at a clean sentence or newline boundary inside the tail
  const boundaryMatch = tail.match(/(?:[.!?。！？]\s+|\n+)([\s\S]+)$/);
  if (boundaryMatch && boundaryMatch[1].trim().length >= 30) {
    return boundaryMatch[1].trim();
  }
  const spaceIdx = tail.indexOf(' ');
  if (spaceIdx > 0 && spaceIdx < 40) {
    return tail.slice(spaceIdx + 1).trim();
  }
  return tail.trim();
}
