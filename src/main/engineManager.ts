import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { computeBackendOrder, resolveEngineBackendDir } from './hardware';
import type {
  ActiveBackend,
  AppSettings,
  EngineStatus,
  HardwareInfo,
  InstalledModel,
} from '../shared/types';

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to allocate ephemeral port')));
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class EngineManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private status: EngineStatus = {
    state: 'stopped',
    activeBackend: null,
    activeModelId: null,
    activeModelName: null,
    port: null,
    gpuLayers: 0,
    contextSize: 4096,
  };
  private recentLogs: string[] = [];
  private isStopping = false;
  private startSequence = 0;

  private readonly engineSearchDirs: string[];

  constructor(engineSearchDirs: string | string[]) {
    super();
    this.engineSearchDirs = Array.isArray(engineSearchDirs) ? engineSearchDirs : [engineSearchDirs];
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  getBaseUrl(): string | null {
    if (this.status.state !== 'ready' || !this.status.port) return null;
    return `http://127.0.0.1:${this.status.port}`;
  }

  getRecentLogs(): string[] {
    return [...this.recentLogs];
  }

  private appendLog(line: string): void {
    const clean = line.trim();
    if (!clean) return;
    this.recentLogs.push(clean);
    if (this.recentLogs.length > 120) {
      this.recentLogs.shift();
    }
  }

  private setStatus(next: EngineStatus): void {
    this.status = next;
    this.emit('status', this.getStatus());
  }

  async stop(): Promise<void> {
    this.startSequence++;
    const proc = this.child;
    this.child = null;
    this.isStopping = true;

    if (proc && proc.pid && !proc.killed) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        proc.once('exit', done);
        setTimeout(() => {
          if (!settled && proc.pid) {
            if (process.platform === 'win32') {
              try {
                execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
                  windowsHide: true,
                  stdio: 'ignore',
                });
              } catch {
                // process may already be gone
              }
            } else {
              try {
                proc.kill('SIGKILL');
              } catch {
                // ignore
              }
            }
            done();
          }
        }, 2000);
      });
    }

    this.isStopping = false;
    this.setStatus({
      state: 'stopped',
      activeBackend: null,
      activeModelId: null,
      activeModelName: null,
      port: null,
      gpuLayers: 0,
      contextSize: 4096,
    });
  }

  async start(
    model: InstalledModel,
    settings: AppSettings,
    hardware: HardwareInfo,
  ): Promise<EngineStatus> {
    await this.stop();
    const seq = ++this.startSequence;

    if (!fs.existsSync(model.filePath)) {
      const errStatus: EngineStatus = {
        state: 'error',
        activeBackend: null,
        activeModelId: model.id,
        activeModelName: model.name,
        port: null,
        gpuLayers: 0,
        contextSize: settings.contextSize,
        error: `모델 파일을 찾을 수 없습니다: ${model.filePath}`,
      };
      this.setStatus(errStatus);
      return errStatus;
    }

    const backendOrder = computeBackendOrder(
      settings.preferredBackend,
      hardware.availableEngines,
      hardware.primaryGpu,
    );

    if (backendOrder.length === 0) {
      const errStatus: EngineStatus = {
        state: 'error',
        activeBackend: null,
        activeModelId: model.id,
        activeModelName: model.name,
        port: null,
        gpuLayers: 0,
        contextSize: settings.contextSize,
        error:
          '내장 추론 엔진(llama-server.exe)이 없습니다. `pnpm fetch:engines`를 실행해 엔진 바이너리를 준비하세요.',
      };
      this.setStatus(errStatus);
      return errStatus;
    }

    const failures: string[] = [];
    const primaryTarget = backendOrder[0];

    for (const backend of backendOrder) {
      if (seq !== this.startSequence) {
        return this.getStatus();
      }

      const effectiveGpuLayers = backend === 'cpu' ? 0 : settings.gpuLayers;
      this.setStatus({
        state: 'starting',
        activeBackend: backend,
        activeModelId: model.id,
        activeModelName: model.name,
        port: null,
        gpuLayers: effectiveGpuLayers,
        contextSize: settings.contextSize,
      });

      const attempt = await this.trySpawnBackend(
        backend,
        model,
        settings,
        effectiveGpuLayers,
        seq,
      );

      if (seq !== this.startSequence) {
        return this.getStatus();
      }

      if (attempt.ok && attempt.port) {
        const fallbackNotice =
          backend !== primaryTarget
            ? `${primaryTarget.toUpperCase()} 가속 초기화 실패로 ${backend.toUpperCase()} 백엔드로 자동 전환되었습니다.`
            : undefined;

        const readyStatus: EngineStatus = {
          state: 'ready',
          activeBackend: backend,
          activeModelId: model.id,
          activeModelName: model.name,
          port: attempt.port,
          gpuLayers: effectiveGpuLayers,
          contextSize: settings.contextSize,
          fallbackNotice,
        };
        this.setStatus(readyStatus);
        return readyStatus;
      }

      failures.push(`${backend.toUpperCase()}: ${attempt.error ?? '알 수 없는 오류'}`);
    }

    const failedStatus: EngineStatus = {
      state: 'error',
      activeBackend: null,
      activeModelId: model.id,
      activeModelName: model.name,
      port: null,
      gpuLayers: 0,
      contextSize: settings.contextSize,
      error: `모든 추론 백엔드 기동에 실패했습니다.\n${failures.join('\n')}`,
    };
    this.setStatus(failedStatus);
    return failedStatus;
  }

  private async trySpawnBackend(
    backend: ActiveBackend,
    model: InstalledModel,
    settings: AppSettings,
    gpuLayers: number,
    seq: number,
  ): Promise<{ ok: boolean; port?: number; error?: string }> {
    const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const backendDir = resolveEngineBackendDir(backend, this.engineSearchDirs);
    if (!backendDir) {
      return { ok: false, error: `${backend.toUpperCase()} 엔진이 설치되어 있지 않습니다.` };
    }
    const exePath = path.join(backendDir, exeName);

    const port = await findFreePort();
    this.recentLogs = [];

    const args: string[] = [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-m',
      model.filePath,
      '-c',
      String(settings.contextSize),
      '-ngl',
      String(gpuLayers),
      '--no-webui',
    ];

    if (settings.threads > 0) {
      args.push('-t', String(settings.threads));
    }

    if (settings.flashAttention && backend !== 'cpu') {
      args.push('-fa', 'on');
    }

    const proc = spawn(exePath, args, {
      cwd: backendDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${backendDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    this.child = proc;

    let exited = false;
    let exitCode: number | null = null;
    let spawnError: string | null = null;

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        this.appendLog(line);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        this.appendLog(line);
      }
    });

    proc.on('error', (err) => {
      spawnError = err.message;
      exited = true;
    });

    proc.on('exit', (code) => {
      exitCode = code;
      exited = true;
      // Unexpected crash after ready
      if (!this.isStopping && this.child === proc && this.status.state === 'ready') {
        this.child = null;
        this.setStatus({
          state: 'error',
          activeBackend: null,
          activeModelId: model.id,
          activeModelName: model.name,
          port: null,
          gpuLayers: 0,
          contextSize: settings.contextSize,
          error: `추론 엔진(${backend.toUpperCase()})이 예기치 않게 종료되었습니다 (code: ${code ?? 'unknown'}).`,
        });
      }
    });

    // Wait up to 90s for large models (12B GGUF) to load into VRAM/RAM
    const deadline = Date.now() + 90_000;
    const healthUrl = `http://127.0.0.1:${port}/health`;

    while (Date.now() < deadline) {
      if (seq !== this.startSequence) {
        return { ok: false, error: '초기화가 취소되었습니다.' };
      }
      if (exited) {
        const tail = this.recentLogs.slice(-4).join(' | ');
        return {
          ok: false,
          error: spawnError ?? `프로세스 조기 종료 (code=${exitCode})${tail ? `: ${tail}` : ''}`,
        };
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(healthUrl, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { status?: string };
          if (data.status === 'ok' || res.status === 200) {
            return { ok: true, port };
          }
        }
      } catch {
        // Server not listening yet
      }

      await sleep(350);
    }

    // Timeout: kill stuck process
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    this.child = null;
    return { ok: false, error: '엔진 로딩 제한 시간(90초) 초과' };
  }
}
