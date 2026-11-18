import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { ActiveBackend, EngineDownloadProgress } from '../shared/types';

const execFileAsync = promisify(execFile);

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

const KEEP_EXTENSIONS = new Set(['.dll']);
const KEEP_EXECUTABLES = new Set(['llama-server.exe']);

export class EngineDownloader extends EventEmitter {
  private activeControllers = new Map<ActiveBackend, AbortController>();

  constructor(private readonly writableEnginesDir: string) {
    super();
  }

  private emitProgress(progress: EngineDownloadProgress): void {
    this.emit('progress', progress);
  }

  cancel(backend: ActiveBackend): void {
    const controller = this.activeControllers.get(backend);
    if (controller) {
      controller.abort();
    }
  }

  async downloadBackend(backend: ActiveBackend): Promise<string> {
    if (this.activeControllers.has(backend)) {
      throw new Error(`${backend.toUpperCase()} 엔진을 이미 다운로드 중입니다.`);
    }

    const controller = new AbortController();
    this.activeControllers.set(backend, controller);
    const tmpDir = path.join(this.writableEnginesDir, `.tmp-${backend}`);
    const stagingDir = path.join(this.writableEnginesDir, `.staging-${backend}`);
    const finalDir = path.join(this.writableEnginesDir, backend);

    try {
      this.emitProgress({
        backend,
        state: 'fetching_release',
        bytesDownloaded: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
      });

      const relRes = await fetch(
        'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10',
        {
          headers: { 'User-Agent': 'LocalTranslate/1.0' },
          signal: controller.signal,
        },
      );
      if (!relRes.ok) {
        throw new Error(`llama.cpp 릴리스 조회 실패 (HTTP ${relRes.status})`);
      }
      const releases = (await relRes.json()) as GithubRelease[];
      const release = releases.find(
        (r) =>
          Array.isArray(r.assets) && r.assets.some((a) => /bin-win-cpu-x64\.zip$/i.test(a.name)),
      );
      if (!release) {
        throw new Error('Windows x64 llama.cpp 릴리스를 찾지 못했습니다.');
      }

      const findAsset = (re: RegExp) => release.assets.find((a) => re.test(a.name));
      const assetList: GithubAsset[] =
        backend === 'cuda'
          ? [
              findAsset(/llama-.*-bin-win-cuda-12\.4-x64\.zip$/i),
              findAsset(/cudart-llama-bin-win-cuda-12\.4-x64\.zip$/i),
            ].filter((a): a is GithubAsset => Boolean(a))
          : backend === 'vulkan'
            ? [findAsset(/llama-.*-bin-win-vulkan-x64\.zip$/i)].filter(
                (a): a is GithubAsset => Boolean(a),
              )
            : [findAsset(/llama-.*-bin-win-cpu-x64\.zip$/i)].filter(
                (a): a is GithubAsset => Boolean(a),
              );

      if (assetList.length === 0) {
        throw new Error(`${backend.toUpperCase()}용 Windows 바이너리를 찾지 못했습니다.`);
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.mkdirSync(stagingDir, { recursive: true });

      const totalBytes = assetList.reduce((sum, a) => sum + (a.size || 0), 0);
      let completedPriorBytes = 0;
      const downloadedZips: string[] = [];

      for (let i = 0; i < assetList.length; i++) {
        const asset = assetList[i];
        const zipPath = path.join(tmpDir, asset.name);
        const label = `${asset.name} (${i + 1}/${assetList.length})`;

        const res = await fetch(asset.browser_download_url, {
          headers: { 'User-Agent': 'LocalTranslate/1.0' },
          redirect: 'follow',
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`${asset.name} 다운로드 실패 (HTTP ${res.status})`);
        }

        const out = fs.createWriteStream(zipPath);
        const reader = res.body.getReader();
        let fileDownloaded = 0;
        let lastTickTime = Date.now();
        let lastTickBytes = 0;

        try {
          while (true) {
            const { value: chunk, done } = await reader.read();
            if (done) break;
            if (!chunk) continue;
            const buf = Buffer.from(chunk);
            if (!out.write(buf)) {
              await new Promise<void>((resolve) => out.once('drain', resolve));
            }
            fileDownloaded += buf.length;

            const now = Date.now();
            const elapsed = now - lastTickTime;
            if (elapsed >= 300) {
              const speed = Math.round(((fileDownloaded - lastTickBytes) / elapsed) * 1000);
              lastTickTime = now;
              lastTickBytes = fileDownloaded;
              this.emitProgress({
                backend,
                state: 'downloading',
                fileLabel: label,
                bytesDownloaded: completedPriorBytes + fileDownloaded,
                totalBytes,
                speedBytesPerSec: speed,
              });
            }
          }
          await new Promise<void>((resolve, reject) => {
            out.end();
            out.on('finish', resolve);
            out.on('error', reject);
          });
        } catch (err) {
          out.destroy();
          throw err;
        }

        completedPriorBytes += fileDownloaded;
        downloadedZips.push(zipPath);
      }

      // Extract zips into staging dir
      this.emitProgress({
        backend,
        state: 'extracting',
        fileLabel: '압축 해제 및 엔진 구성 중...',
        bytesDownloaded: totalBytes,
        totalBytes,
        speedBytesPerSec: 0,
      });

      for (const zipPath of downloadedZips) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        await execFileAsync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${stagingDir.replace(/'/g, "''")}' -Force`,
          ],
          { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
        );
      }

      this.flattenAndPrune(stagingDir);

      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(finalDir), { recursive: true });
      fs.renameSync(stagingDir, finalDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });

      this.emitProgress({
        backend,
        state: 'completed',
        bytesDownloaded: totalBytes,
        totalBytes,
        speedBytesPerSec: 0,
      });

      return finalDir;
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });

      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        this.emitProgress({
          backend,
          state: 'cancelled',
          bytesDownloaded: 0,
          totalBytes: 0,
          speedBytesPerSec: 0,
        });
        throw new Error('엔진 다운로드가 취소되었습니다.');
      }

      const message = err instanceof Error ? err.message : String(err);
      this.emitProgress({
        backend,
        state: 'error',
        bytesDownloaded: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        error: message,
      });
      throw err;
    } finally {
      this.activeControllers.delete(backend);
    }
  }

  private flattenAndPrune(dir: string): void {
    const collected: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else collected.push(full);
      }
    };
    walk(dir);

    const kept = new Set<string>();
    for (const file of collected) {
      const base = path.basename(file);
      const lower = base.toLowerCase();
      const ext = path.extname(lower);
      if (KEEP_EXECUTABLES.has(lower) || KEEP_EXTENSIONS.has(ext)) {
        const dest = path.join(dir, base);
        if (path.resolve(file) !== path.resolve(dest)) {
          fs.copyFileSync(file, dest);
        }
        kept.add(lower);
      }
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() || !kept.has(entry.name.toLowerCase())) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  }
}
