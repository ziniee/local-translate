import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActiveBackend, BackendPreference, GpuInfo, HardwareInfo } from '../shared/types';

const execFileAsync = promisify(execFile);

export function parseNvidiaSmiOutput(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const name = parts[0];
    const vramMatch = parts[1].match(/(\d+(?:\.\d+)?)/);
    const vramMB = vramMatch ? Math.round(Number(vramMatch[1])) : 0;
    const driverVersion = parts[2] || undefined;
    gpus.push({
      name,
      vramMB,
      driverVersion,
      vendor: 'nvidia',
    });
  }
  return gpus;
}

export function classifyGpuVendor(name: string): GpuInfo['vendor'] {
  const lower = name.toLowerCase();
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('rtx') || lower.includes('gtx') || lower.includes('quadro')) {
    return 'nvidia';
  }
  if (lower.includes('amd') || lower.includes('radeon')) {
    return 'amd';
  }
  if (lower.includes('intel') || lower.includes('arc') || lower.includes('iris') || lower.includes('uhd')) {
    return 'intel';
  }
  return 'unknown';
}

export function computeBackendOrder(
  preference: BackendPreference,
  availableEngines: ActiveBackend[],
  primaryGpu: GpuInfo | null,
): ActiveBackend[] {
  const availableSet = new Set(availableEngines);
  let desired: ActiveBackend[];

  if (preference !== 'auto') {
    const fallbackChain: ActiveBackend[] =
      preference === 'cuda'
        ? ['cuda', 'vulkan', 'cpu']
        : preference === 'vulkan'
          ? ['vulkan', 'cpu']
          : ['cpu'];
    desired = fallbackChain;
  } else if (primaryGpu?.vendor === 'nvidia') {
    desired = ['cuda', 'vulkan', 'cpu'];
  } else if (primaryGpu && (primaryGpu.vendor === 'amd' || primaryGpu.vendor === 'intel')) {
    desired = ['vulkan', 'cpu'];
  } else {
    desired = ['cpu', 'vulkan'];
  }

  return desired.filter((b) => availableSet.has(b));
}

export function getIdealBackendForGpu(primaryGpu: GpuInfo | null): ActiveBackend {
  if (primaryGpu?.vendor === 'nvidia') return 'cuda';
  if (primaryGpu && (primaryGpu.vendor === 'amd' || primaryGpu.vendor === 'intel')) {
    return 'vulkan';
  }
  return 'cpu';
}

export function recommendHardwareConfig(
  primaryGpu: GpuInfo | null,
  totalRamMB: number,
  availableEngines: ActiveBackend[],
): Pick<
  HardwareInfo,
  | 'recommendedBackend'
  | 'missingRecommendedBackend'
  | 'recommendedModelId'
  | 'recommendedGpuLayers'
  | 'recommendedContextSize'
> {
  const idealBackend = getIdealBackendForGpu(primaryGpu);
  const order = computeBackendOrder('auto', availableEngines, primaryGpu);
  const recommendedBackend: ActiveBackend = order[0] ?? 'cpu';
  const missingRecommendedBackend: ActiveBackend | null = availableEngines.includes(idealBackend)
    ? null
    : idealBackend;

  const vramMB = primaryGpu?.vramMB ?? 0;

  let recommendedModelId = 'gemma-3-4b-it-q4km';
  let recommendedGpuLayers = 0;
  let recommendedContextSize = 4096;

  if (recommendedBackend === 'cuda' || recommendedBackend === 'vulkan' || idealBackend !== 'cpu') {
    if (vramMB >= 10000) {
      // RTX 3060 12GB and above: Gemma 3 12B Q4_K_M (~7.3GB) fits 100% in VRAM with 8K context
      recommendedModelId = 'gemma-3-12b-it-q4km';
      recommendedGpuLayers = 99;
      recommendedContextSize = 8192;
    } else if (vramMB >= 6000) {
      recommendedModelId = 'exaone-3.5-7.8b-q4km';
      recommendedGpuLayers = 99;
      recommendedContextSize = 6144;
    } else if (vramMB >= 3500) {
      recommendedModelId = 'gemma-3-4b-it-q4km';
      recommendedGpuLayers = 99;
      recommendedContextSize = 4096;
    } else {
      recommendedModelId = 'qwen-2.5-1.5b-q4km';
      recommendedGpuLayers = 20;
      recommendedContextSize = 4096;
    }
  } else {
    // CPU only
    recommendedGpuLayers = 0;
    recommendedContextSize = 4096;
    if (totalRamMB >= 16000) {
      recommendedModelId = 'gemma-3-4b-it-q4km';
    } else {
      recommendedModelId = 'qwen-2.5-1.5b-q4km';
    }
  }

  return {
    recommendedBackend,
    missingRecommendedBackend,
    recommendedModelId,
    recommendedGpuLayers,
    recommendedContextSize,
  };
}

export function getEnginesBaseDir(isPackaged: boolean, resourcesPath: string, appPath: string): string {
  if (isPackaged) {
    return path.join(resourcesPath, 'engines');
  }
  return path.join(appPath, 'resources', 'engines');
}

export function resolveEngineBackendDir(
  backend: ActiveBackend,
  enginesDirs: string | string[],
): string | null {
  const dirs = Array.isArray(enginesDirs) ? enginesDirs : [enginesDirs];
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  for (const baseDir of dirs) {
    const candidate = path.join(baseDir, backend);
    if (fs.existsSync(path.join(candidate, exeName))) {
      return candidate;
    }
  }
  return null;
}

export function detectAvailableEngines(enginesDirs: string | string[]): ActiveBackend[] {
  const candidates: ActiveBackend[] = ['cuda', 'vulkan', 'cpu'];
  return candidates.filter((backend) => resolveEngineBackendDir(backend, enginesDirs) !== null);
}

async function detectNvidiaGpus(): Promise<GpuInfo[]> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
      { timeout: 3000, windowsHide: true },
    );
    return parseNvidiaSmiOutput(stdout);
  } catch {
    return [];
  }
}

async function detectWindowsGpusFallback(): Promise<GpuInfo[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress',
      ],
      { timeout: 4000, windowsHide: true },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const gpus: GpuInfo[] = [];
    for (const item of list) {
      if (!item?.Name) continue;
      const ramBytes = Number(item.AdapterRAM || 0);
      gpus.push({
        name: String(item.Name),
        vramMB: ramBytes > 0 ? Math.round(ramBytes / (1024 * 1024)) : 0,
        vendor: classifyGpuVendor(String(item.Name)),
      });
    }
    return gpus;
  } catch {
    return [];
  }
}

export async function detectHardware(enginesDirs: string | string[]): Promise<HardwareInfo> {
  let gpus = await detectNvidiaGpus();
  if (gpus.length === 0) {
    gpus = await detectWindowsGpusFallback();
  }

  // Prefer discrete NVIDIA/AMD GPU with highest VRAM
  const sortedGpus = [...gpus].sort((a, b) => {
    const vendorScore = (v: GpuInfo['vendor']) =>
      v === 'nvidia' ? 3 : v === 'amd' ? 2 : v === 'intel' ? 1 : 0;
    const diff = vendorScore(b.vendor) - vendorScore(a.vendor);
    return diff !== 0 ? diff : b.vramMB - a.vramMB;
  });

  const primaryGpu = sortedGpus[0] ?? null;
  const totalRamMB = Math.round(os.totalmem() / (1024 * 1024));
  const cpuCores = os.cpus().length;
  const availableEngines = detectAvailableEngines(enginesDirs);

  const rec = recommendHardwareConfig(primaryGpu, totalRamMB, availableEngines);

  return {
    gpus: sortedGpus,
    primaryGpu,
    totalRamMB,
    cpuCores,
    availableEngines,
    ...rec,
  };
}
