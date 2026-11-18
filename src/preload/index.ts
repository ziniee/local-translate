import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActiveBackend,
  AppRuntimeInfo,
  AppSettings,
  EngineDownloadProgress,
  EngineStatus,
  GlossaryEntry,
  HardwareInfo,
  HistoryEntry,
  InstalledModel,
  ModelCatalogItem,
  ModelDownloadProgress,
  TranslationRequest,
  TranslationStreamEvent,
} from '../shared/types';

const api = {
  // Hardware & System
  detectHardware: (forceRefresh = false): Promise<HardwareInfo> =>
    ipcRenderer.invoke('hardware:detect', forceRefresh),
  getRuntimeInfo: (): Promise<AppRuntimeInfo> => ipcRenderer.invoke('system:runtime-info'),
  downloadEngineBackend: (backend: ActiveBackend): Promise<HardwareInfo> =>
    ipcRenderer.invoke('engines:download', backend),
  cancelEngineDownload: (backend: ActiveBackend): Promise<void> =>
    ipcRenderer.invoke('engines:cancel-download', backend),
  onEngineDownloadProgress: (cb: (progress: EngineDownloadProgress) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: EngineDownloadProgress) =>
      cb(progress);
    ipcRenderer.on('engines:download-progress', handler);
    return () => ipcRenderer.removeListener('engines:download-progress', handler);
  },
  openModelsFolder: (): Promise<string> => ipcRenderer.invoke('system:open-models-folder'),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('system:read-clipboard'),
  writeClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke('system:write-clipboard', text),
  onQuickTranslate: (cb: (text: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('system:quick-translate', handler);
    return () => ipcRenderer.removeListener('system:quick-translate', handler);
  },

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (
    patch: Partial<AppSettings>,
  ): Promise<{ settings: AppSettings; shortcutRegistered: boolean }> =>
    ipcRenderer.invoke('settings:update', patch),
  chooseModelsDir: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-models-dir'),

  // Models
  getModelCatalog: (): Promise<ModelCatalogItem[]> => ipcRenderer.invoke('models:catalog'),
  getInstalledModels: (): Promise<InstalledModel[]> => ipcRenderer.invoke('models:installed'),
  getPartialBytes: (modelId: string): Promise<number> =>
    ipcRenderer.invoke('models:partial-bytes', modelId),
  downloadModel: (modelId: string): Promise<InstalledModel | null> =>
    ipcRenderer.invoke('models:download', modelId),
  pauseDownload: (modelId: string): Promise<void> =>
    ipcRenderer.invoke('models:pause-download', modelId),
  cancelDownload: (modelId: string): Promise<void> =>
    ipcRenderer.invoke('models:cancel-download', modelId),
  importModelDialog: (): Promise<InstalledModel | null> =>
    ipcRenderer.invoke('models:import-dialog'),
  importModelPath: (filePath: string): Promise<InstalledModel> =>
    ipcRenderer.invoke('models:import-path', filePath),
  deleteModel: (modelId: string): Promise<InstalledModel[]> =>
    ipcRenderer.invoke('models:delete', modelId),
  onDownloadProgress: (cb: (progress: ModelDownloadProgress) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: ModelDownloadProgress) =>
      cb(progress);
    ipcRenderer.on('models:download-progress', handler);
    return () => ipcRenderer.removeListener('models:download-progress', handler);
  },

  // Engine
  getEngineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:status'),
  getEngineLogs: (): Promise<string[]> => ipcRenderer.invoke('engine:logs'),
  startEngine: (modelId?: string): Promise<EngineStatus> =>
    ipcRenderer.invoke('engine:start', modelId),
  stopEngine: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:stop'),
  onEngineStatusChanged: (cb: (status: EngineStatus) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: EngineStatus) => cb(status);
    ipcRenderer.on('engine:status-changed', handler);
    return () => ipcRenderer.removeListener('engine:status-changed', handler);
  },

  // Translation
  translate: (request: TranslationRequest): Promise<void> =>
    ipcRenderer.invoke('translate:start', request),
  abortTranslation: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('translate:abort', requestId),
  onTranslationStream: (cb: (event: TranslationStreamEvent) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: TranslationStreamEvent) => cb(event);
    ipcRenderer.on('translate:stream', handler);
    return () => ipcRenderer.removeListener('translate:stream', handler);
  },

  // Files
  openTextFile: (): Promise<{ filePath: string; content: string } | null> =>
    ipcRenderer.invoke('files:open-text'),
  saveTextFile: (content: string, suggestedName?: string): Promise<string | null> =>
    ipcRenderer.invoke('files:save-text', content, suggestedName),

  // Glossary
  listGlossary: (): Promise<GlossaryEntry[]> => ipcRenderer.invoke('glossary:list'),
  saveGlossary: (entries: GlossaryEntry[]): Promise<GlossaryEntry[]> =>
    ipcRenderer.invoke('glossary:save', entries),
  exportGlossary: (): Promise<string | null> => ipcRenderer.invoke('glossary:export'),
  importGlossary: (): Promise<GlossaryEntry[] | null> => ipcRenderer.invoke('glossary:import'),

  // History
  listHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
  deleteHistory: (id: string): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:delete', id),
  clearHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:clear'),
};

export type LocalTranslateApi = typeof api;

contextBridge.exposeInMainWorld('localTranslate', api);
