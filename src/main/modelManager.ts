import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MODEL_CATALOG } from '../shared/catalog';
import type { InstalledModel, ModelCatalogItem, ModelDownloadProgress } from '../shared/types';
import type { LocalStorageStore } from './storage';

interface ActiveDownload {
  modelId: string;
  controller: AbortController;
  paused: boolean;
  cancelled: boolean;
}

export class ModelManager extends EventEmitter {
  private activeDownloads = new Map<string, ActiveDownload>();

  constructor(private readonly store: LocalStorageStore) {
    super();
  }

  getCatalog(): ModelCatalogItem[] {
    return MODEL_CATALOG;
  }

  getModelsDir(): string {
    const dir = this.store.getSettings().modelsDir;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  listInstalledModels(): InstalledModel[] {
    const modelsDir = this.getModelsDir();
    const installed: InstalledModel[] = [];
    const seenPaths = new Set<string>();

    // 1. Scan modelsDir for .gguf files
    if (fs.existsSync(modelsDir)) {
      for (const entry of fs.readdirSync(modelsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) continue;
        const fullPath = path.join(modelsDir, entry.name);
        const stat = fs.statSync(fullPath);
        const catalogMatch = MODEL_CATALOG.find(
          (c) => c.filename.toLowerCase() === entry.name.toLowerCase(),
        );
        seenPaths.add(path.resolve(fullPath).toLowerCase());

        installed.push({
          id: catalogMatch ? catalogMatch.id : `local-${entry.name}`,
          name: catalogMatch ? catalogMatch.name : entry.name.replace(/\.gguf$/i, ''),
          filename: entry.name,
          filePath: fullPath,
          sizeBytes: stat.size,
          isCustom: !catalogMatch,
          catalogId: catalogMatch?.id,
          addedAt: stat.mtime.toISOString(),
        });
      }
    }

    // 2. Append externally imported custom .gguf models
    for (const custom of this.store.resolveCustomInstalledModels()) {
      const normalized = path.resolve(custom.filePath).toLowerCase();
      if (!seenPaths.has(normalized)) {
        seenPaths.add(normalized);
        installed.push(custom);
      }
    }

    return installed;
  }

  getInstalledModelById(id: string): InstalledModel | undefined {
    return this.listInstalledModels().find((m) => m.id === id);
  }

  importLocalModel(filePath: string): InstalledModel {
    if (!fs.existsSync(filePath)) {
      throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
    }
    if (!filePath.toLowerCase().endsWith('.gguf')) {
      throw new Error('GGUF 형식(.gguf) 모델 파일만 가져올 수 있습니다.');
    }

    const resolved = path.resolve(filePath);
    const existing = this.listInstalledModels().find(
      (m) => path.resolve(m.filePath).toLowerCase() === resolved.toLowerCase(),
    );
    if (existing) {
      return existing;
    }

    const stat = fs.statSync(resolved);
    const filename = path.basename(resolved);
    const id = `custom-${crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 10)}`;
    const name = filename.replace(/\.gguf$/i, '');
    const addedAt = new Date().toISOString();

    const customs = this.store.getCustomModels();
    customs.push({ id, name, filePath: resolved, addedAt });
    this.store.saveCustomModels(customs);

    return {
      id,
      name,
      filename,
      filePath: resolved,
      sizeBytes: stat.size,
      isCustom: true,
      addedAt,
    };
  }

  deleteModel(modelId: string): void {
    const model = this.getInstalledModelById(modelId);
    if (!model) return;

    const modelsDir = path.resolve(this.getModelsDir()).toLowerCase();
    const modelPath = path.resolve(model.filePath).toLowerCase();

    if (modelPath.startsWith(modelsDir)) {
      // Managed model inside app modelsDir -> delete file
      if (fs.existsSync(model.filePath)) {
        fs.unlinkSync(model.filePath);
      }
    } else {
      // Externally imported file -> unregister only without deleting user's original file
      const remaining = this.store.getCustomModels().filter((c) => c.id !== modelId);
      this.store.saveCustomModels(remaining);
    }

    const settings = this.store.getSettings();
    if (settings.activeModelId === modelId) {
      this.store.updateSettings({ activeModelId: null });
    }
  }

  getPartialBytes(modelId: string): number {
    const catalog = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!catalog) return 0;
    const partPath = path.join(this.getModelsDir(), `${catalog.filename}.part`);
    if (fs.existsSync(partPath)) {
      return fs.statSync(partPath).size;
    }
    return 0;
  }

  pauseDownload(modelId: string): void {
    const active = this.activeDownloads.get(modelId);
    if (active) {
      active.paused = true;
      active.controller.abort();
    }
  }

  cancelDownload(modelId: string): void {
    const active = this.activeDownloads.get(modelId);
    if (active) {
      active.cancelled = true;
      active.controller.abort();
    } else {
      const catalog = MODEL_CATALOG.find((m) => m.id === modelId);
      if (catalog) {
        const partPath = path.join(this.getModelsDir(), `${catalog.filename}.part`);
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath);
        }
      }
      this.emitProgress({
        modelId,
        state: 'cancelled',
        bytesDownloaded: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        etaSeconds: null,
      });
    }
  }

  private emitProgress(progress: ModelDownloadProgress): void {
    this.emit('download-progress', progress);
  }

  async downloadModel(modelId: string): Promise<InstalledModel | null> {
    const catalog = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!catalog) {
      throw new Error(`카탈로그에서 모델을 찾을 수 없습니다: ${modelId}`);
    }

    if (this.activeDownloads.has(modelId)) {
      throw new Error('이미 다운로드가 진행 중인 모델입니다.');
    }

    const modelsDir = this.getModelsDir();
    const finalPath = path.join(modelsDir, catalog.filename);
    const partPath = `${finalPath}.part`;

    if (fs.existsSync(finalPath)) {
      const existing = this.getInstalledModelById(modelId);
      if (existing) return existing;
    }

    let existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    if (existingBytes > catalog.sizeBytes) {
      fs.unlinkSync(partPath);
      existingBytes = 0;
    }

    const controller = new AbortController();
    const activeState: ActiveDownload = {
      modelId,
      controller,
      paused: false,
      cancelled: false,
    };
    this.activeDownloads.set(modelId, activeState);

    let writeStream: fs.WriteStream | null = null;
    let downloaded = existingBytes;
    let totalBytes = catalog.sizeBytes;

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'LocalTranslate/1.0',
      };
      if (existingBytes > 0) {
        headers.Range = `bytes=${existingBytes}-`;
      }

      const response = await fetch(catalog.downloadUrl, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`다운로드 서버 오류 (HTTP ${response.status})`);
      }
      if (!response.body) {
        throw new Error('응답 스트림이 비어 있습니다.');
      }

      // If server ignored Range header and sent 200, restart file from 0
      const isResumed = response.status === 206 && existingBytes > 0;
      if (!isResumed) {
        downloaded = 0;
        const contentLen = Number(response.headers.get('content-length') || 0);
        if (contentLen > 0) totalBytes = contentLen;
      } else {
        const contentRange = response.headers.get('content-range');
        const rangeTotalMatch = contentRange?.match(/\/(\d+)$/);
        if (rangeTotalMatch) {
          totalBytes = Number(rangeTotalMatch[1]);
        }
      }

      writeStream = fs.createWriteStream(partPath, { flags: isResumed ? 'a' : 'w' });

      let lastTickTime = Date.now();
      let lastTickBytes = downloaded;
      let speed = 0;

      this.emitProgress({
        modelId,
        state: 'downloading',
        bytesDownloaded: downloaded,
        totalBytes,
        speedBytesPerSec: 0,
        etaSeconds: null,
      });

      const reader = response.body.getReader();
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        if (!chunk) continue;
        const buf = Buffer.from(chunk);
        if (!writeStream.write(buf)) {
          await new Promise<void>((resolve) => writeStream!.once('drain', resolve));
        }
        downloaded += buf.length;

        const now = Date.now();
        const elapsedMs = now - lastTickTime;
        if (elapsedMs >= 300) {
          speed = ((downloaded - lastTickBytes) / elapsedMs) * 1000;
          lastTickTime = now;
          lastTickBytes = downloaded;
          const remaining = Math.max(0, totalBytes - downloaded);
          const etaSeconds = speed > 0 ? Math.round(remaining / speed) : null;

          this.emitProgress({
            modelId,
            state: 'downloading',
            bytesDownloaded: downloaded,
            totalBytes,
            speedBytesPerSec: Math.round(speed),
            etaSeconds,
          });
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream!.end();
        writeStream!.on('finish', resolve);
        writeStream!.on('error', reject);
      });
      writeStream = null;

      // Verify SHA-256 integrity
      this.emitProgress({
        modelId,
        state: 'verifying',
        bytesDownloaded: totalBytes,
        totalBytes,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      });

      const actualSha = await this.computeFileSha256(partPath);
      if (catalog.sha256 && actualSha.toLowerCase() !== catalog.sha256.toLowerCase()) {
        fs.unlinkSync(partPath);
        throw new Error('파일 무결성(SHA-256) 검증에 실패했습니다. 다시 다운로드해 주세요.');
      }

      fs.renameSync(partPath, finalPath);

      this.emitProgress({
        modelId,
        state: 'completed',
        bytesDownloaded: totalBytes,
        totalBytes,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      });

      return this.getInstalledModelById(modelId) ?? null;
    } catch (err) {
      if (writeStream) {
        writeStream.destroy();
      }
      if (activeState.paused) {
        this.emitProgress({
          modelId,
          state: 'paused',
          bytesDownloaded: downloaded,
          totalBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
        });
        return null;
      }
      if (activeState.cancelled) {
        if (fs.existsSync(partPath)) {
          try {
            fs.unlinkSync(partPath);
          } catch {
            // ignore
          }
        }
        this.emitProgress({
          modelId,
          state: 'cancelled',
          bytesDownloaded: 0,
          totalBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
        });
        return null;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.emitProgress({
        modelId,
        state: 'error',
        bytesDownloaded: downloaded,
        totalBytes,
        speedBytesPerSec: 0,
        etaSeconds: null,
        error: message,
      });
      throw err;
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  private computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
