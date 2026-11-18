import type {
  AppSettings,
  GlossaryEntry,
  TranslationRequest,
  TranslationStreamEvent,
} from '../../shared/types';
import type { EngineManager } from '../engineManager';
import { extractTrailingContext, splitIntoChunks } from './chunker';
import { buildTranslationMessages } from './promptBuilder';

function stripWrapperTags(text: string): string {
  // Small models occasionally echo <translate>...</translate> wrapper tags on continuation chunks
  return text.replace(/^\s*<translate>\s*/i, '').replace(/\s*<\/translate>\s*$/i, '');
}

export class TranslationService {
  private activeControllers = new Map<string, AbortController>();

  constructor(private readonly engine: EngineManager) {}

  abort(requestId: string): void {
    const controller = this.activeControllers.get(requestId);
    if (controller) {
      controller.abort();
    }
  }

  abortAll(): void {
    for (const controller of this.activeControllers.values()) {
      controller.abort();
    }
    this.activeControllers.clear();
  }

  async translate(
    request: TranslationRequest,
    settings: AppSettings,
    glossary: GlossaryEntry[],
    onEvent: (event: TranslationStreamEvent) => void,
  ): Promise<void> {
    const baseUrl = this.engine.getBaseUrl();
    const engineStatus = this.engine.getStatus();

    if (!baseUrl || engineStatus.state !== 'ready') {
      onEvent({
        requestId: request.requestId,
        type: 'error',
        error: '로컬 LLM 엔진이 준비되지 않았습니다. 먼저 모델을 선택하고 엔진을 시작하세요.',
      });
      return;
    }

    const chunks = splitIntoChunks(request.text, {
      maxChunkChars: request.chunkSize ?? settings.chunkSize,
      preserveCodeBlocks: request.preserveCodeBlocks,
    });

    if (chunks.length === 0) {
      onEvent({
        requestId: request.requestId,
        type: 'done',
        fullText: '',
        stats: {
          tokensGenerated: 0,
          tokensPerSec: 0,
          elapsedMs: 0,
          chunksProcessed: 0,
          backend: engineStatus.activeBackend,
          modelName: engineStatus.activeModelName,
        },
      });
      return;
    }

    const controller = new AbortController();
    this.activeControllers.set(request.requestId, controller);

    const startedAt = Date.now();
    let totalTokens = 0;
    const translatedPieces: string[] = [];
    let previousContext: { sourceTail: string; translatedTail: string } | undefined;

    onEvent({
      requestId: request.requestId,
      type: 'start',
      totalChunks: chunks.length,
    });

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const chunk = chunks[i];
        onEvent({
          requestId: request.requestId,
          type: 'chunk_start',
          chunkIndex: i,
          totalChunks: chunks.length,
          isCodePassthrough: chunk.isCodeBlock,
        });

        // Emit preserved leading separator before chunk tokens
        if (chunk.leadingSeparator) {
          translatedPieces.push(chunk.leadingSeparator);
          onEvent({
            requestId: request.requestId,
            type: 'token',
            chunkIndex: i,
            token: chunk.leadingSeparator,
            tokensPerSec: this.calcTps(totalTokens, startedAt),
          });
        }

        // Verbatim code block passthrough (no LLM round-trip)
        if (chunk.isCodeBlock || !chunk.text.trim()) {
          translatedPieces.push(chunk.text);
          onEvent({
            requestId: request.requestId,
            type: 'token',
            chunkIndex: i,
            token: chunk.text,
            tokensPerSec: this.calcTps(totalTokens, startedAt),
          });
          onEvent({
            requestId: request.requestId,
            type: 'chunk_done',
            chunkIndex: i,
            totalChunks: chunks.length,
            chunkText: chunk.text,
          });
          continue;
        }

        const messages = buildTranslationMessages({
          sourceLang: request.sourceLang,
          targetLang: request.targetLang,
          tone: request.tone,
          customInstruction: request.customInstruction,
          glossary,
          useGlossary: request.useGlossary,
          chunkText: chunk.text,
          previousContext,
        });

        let chunkOutput = '';
        await this.streamChatCompletion(
          baseUrl,
          messages,
          settings,
          controller.signal,
          (delta) => {
            chunkOutput += delta;
            totalTokens++;
            onEvent({
              requestId: request.requestId,
              type: 'token',
              chunkIndex: i,
              token: delta,
              tokensPerSec: this.calcTps(totalTokens, startedAt),
            });
          },
        );

        const cleanedChunk = previousContext ? stripWrapperTags(chunkOutput) : chunkOutput;
        translatedPieces.push(cleanedChunk);

        // Update sliding context for next chunk
        previousContext = {
          sourceTail: extractTrailingContext(chunk.text),
          translatedTail: extractTrailingContext(cleanedChunk),
        };

        onEvent({
          requestId: request.requestId,
          type: 'chunk_done',
          chunkIndex: i,
          totalChunks: chunks.length,
          chunkText: cleanedChunk,
        });
      }

      const elapsedMs = Date.now() - startedAt;
      const fullText = translatedPieces.join('');
      onEvent({
        requestId: request.requestId,
        type: 'done',
        fullText,
        stats: {
          tokensGenerated: totalTokens,
          tokensPerSec: this.calcTps(totalTokens, startedAt),
          elapsedMs,
          chunksProcessed: chunks.length,
          backend: engineStatus.activeBackend,
          modelName: engineStatus.activeModelName,
        },
      });
    } catch (err) {
      const partialText = translatedPieces.join('');
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        onEvent({
          requestId: request.requestId,
          type: 'aborted',
          partialText,
        });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        onEvent({
          requestId: request.requestId,
          type: 'error',
          error: message,
          partialText,
        });
      }
    } finally {
      this.activeControllers.delete(request.requestId);
    }
  }

  private calcTps(tokens: number, startedAt: number): number {
    const secs = (Date.now() - startedAt) / 1000;
    if (secs <= 0.05) return 0;
    return Number((tokens / secs).toFixed(1));
  }

  private async streamChatCompletion(
    baseUrl: string,
    messages: Array<{ role: string; content: string }>,
    settings: AppSettings,
    signal: AbortSignal,
    onDelta: (token: string) => void,
  ): Promise<void> {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        stream: true,
        temperature: settings.temperature,
        top_p: 0.9,
        repeat_penalty: 1.05,
        cache_prompt: settings.cachePrompt,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`로컬 엔진 요청 실패 (HTTP ${response.status}): ${errBody.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!rawLine || !rawLine.startsWith('data:')) continue;
        const payload = rawLine.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            onDelta(delta);
          }
        } catch {
          // ignore malformed partial SSE line
        }
      }
    }
  }
}
