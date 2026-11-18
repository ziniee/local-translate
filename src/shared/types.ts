export type BackendPreference = 'auto' | 'cuda' | 'vulkan' | 'cpu';
export type ActiveBackend = 'cuda' | 'vulkan' | 'cpu';

export type TonePreset = 'natural' | 'formal' | 'technical' | 'casual' | 'literal';

export interface LanguageOption {
  code: string;
  label: string;
  englishName: string;
  allowAsTarget: boolean;
}

export interface ToneOption {
  id: TonePreset;
  label: string;
  description: string;
}

export interface GpuInfo {
  name: string;
  vramMB: number;
  driverVersion?: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'unknown';
}

export interface HardwareInfo {
  gpus: GpuInfo[];
  primaryGpu: GpuInfo | null;
  totalRamMB: number;
  cpuCores: number;
  availableEngines: ActiveBackend[];
  recommendedBackend: ActiveBackend;
  /** Non-null when hardware supports a faster backend (e.g. CUDA on NVIDIA) that is not installed yet */
  missingRecommendedBackend: ActiveBackend | null;
  recommendedModelId: string;
  recommendedGpuLayers: number;
  recommendedContextSize: number;
}

export interface AppRuntimeInfo {
  isPortable: boolean;
  appVersion: string;
  dataDir: string;
  modelsDir: string;
  writableEnginesDir: string;
}

export interface EngineDownloadProgress {
  backend: ActiveBackend;
  state: 'fetching_release' | 'downloading' | 'extracting' | 'completed' | 'error' | 'cancelled';
  fileLabel?: string;
  bytesDownloaded: number;
  totalBytes: number;
  speedBytesPerSec: number;
  error?: string;
}

export interface ModelCatalogItem {
  id: string;
  name: string;
  filename: string;
  repo: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
  quantization: string;
  minVramMB: number;
  minRamMB: number;
  badge: string;
  summary: string;
  strengths: string[];
}

export interface InstalledModel {
  id: string;
  name: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
  isCustom: boolean;
  catalogId?: string;
  addedAt: string;
}

export interface ModelDownloadProgress {
  modelId: string;
  state: 'downloading' | 'paused' | 'verifying' | 'completed' | 'error' | 'cancelled';
  bytesDownloaded: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  error?: string;
}

export interface EngineStatus {
  state: 'stopped' | 'starting' | 'ready' | 'error';
  activeBackend: ActiveBackend | null;
  activeModelId: string | null;
  activeModelName: string | null;
  port: number | null;
  gpuLayers: number;
  contextSize: number;
  fallbackNotice?: string;
  error?: string;
}

export interface GlossaryEntry {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  sourceLang: string; // 'any' or language code
  targetLang: string; // 'any' or language code
  enabled: boolean;
  note?: string;
}

export interface TranslationRequest {
  requestId: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  tone: TonePreset;
  customInstruction?: string;
  useGlossary: boolean;
  preserveCodeBlocks: boolean;
  chunkSize?: number;
}

export interface TranslationStats {
  tokensGenerated: number;
  tokensPerSec: number;
  elapsedMs: number;
  chunksProcessed: number;
  backend: ActiveBackend | null;
  modelName: string | null;
}

export type TranslationStreamEvent =
  | {
      requestId: string;
      type: 'start';
      totalChunks: number;
    }
  | {
      requestId: string;
      type: 'chunk_start';
      chunkIndex: number;
      totalChunks: number;
      isCodePassthrough: boolean;
    }
  | {
      requestId: string;
      type: 'token';
      chunkIndex: number;
      token: string;
      tokensPerSec: number;
    }
  | {
      requestId: string;
      type: 'chunk_done';
      chunkIndex: number;
      totalChunks: number;
      chunkText: string;
    }
  | {
      requestId: string;
      type: 'done';
      fullText: string;
      stats: TranslationStats;
    }
  | {
      requestId: string;
      type: 'aborted';
      partialText: string;
    }
  | {
      requestId: string;
      type: 'error';
      error: string;
      partialText?: string;
    };

export interface HistoryEntry {
  id: string;
  createdAt: string;
  sourceLang: string;
  targetLang: string;
  tone: TonePreset;
  modelName: string;
  sourceText: string;
  translatedText: string;
  tokensPerSec: number;
}

export interface AppSettings {
  preferredBackend: BackendPreference;
  gpuLayers: number; // 99 = all layers
  contextSize: number;
  threads: number; // 0 = auto
  temperature: number;
  flashAttention: boolean;
  cachePrompt: boolean;
  chunkSize: number;
  preserveCodeBlocks: boolean;
  globalShortcut: string;
  minimizeToTray: boolean;
  modelsDir: string;
  activeModelId: string | null;
  defaultSourceLang: string;
  defaultTargetLang: string;
  defaultTone: TonePreset;
}
