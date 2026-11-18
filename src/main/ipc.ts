import crypto from 'node:crypto';
import fs from 'node:fs';
import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { detectHardware } from './hardware';
import type { EngineDownloader } from './engineDownloader';
import type { EngineManager } from './engineManager';
import type { ModelManager } from './modelManager';
import type { ResolvedAppPaths } from './paths';
import type { LocalStorageStore } from './storage';
import type { TranslationService } from './translation/translator';
import type {
  ActiveBackend,
  AppRuntimeInfo,
  AppSettings,
  GlossaryEntry,
  HardwareInfo,
  HistoryEntry,
  TranslationRequest,
} from '../shared/types';

export interface IpcDeps {
  getWindow: () => BrowserWindow | null;
  appPaths: ResolvedAppPaths;
  store: LocalStorageStore;
  engine: EngineManager;
  engineDownloader: EngineDownloader;
  models: ModelManager;
  translator: TranslationService;
  onShortcutChanged: (shortcut: string) => boolean;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { getWindow, appPaths, store, engine, engineDownloader, models, translator, onShortcutChanged } =
    deps;

  let cachedHardware: HardwareInfo | null = null;
  const getHardware = async (forceRefresh = false): Promise<HardwareInfo> => {
    if (!cachedHardware || forceRefresh) {
      cachedHardware = await detectHardware(appPaths.engineSearchDirs);
    }
    return cachedHardware;
  };

  // Forward engine status changes to renderer
  engine.on('status', (status) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('engine:status-changed', status);
    }
  });

  // Forward model download progress to renderer
  models.on('download-progress', (progress) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('models:download-progress', progress);
    }
  });

  // Forward engine backend download progress to renderer
  engineDownloader.on('progress', (progress) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('engines:download-progress', progress);
    }
  });

  // --- Hardware & System ---
  ipcMain.handle('hardware:detect', async (_e, forceRefresh?: boolean) => {
    return getHardware(Boolean(forceRefresh));
  });

  ipcMain.handle('system:runtime-info', (): AppRuntimeInfo => ({
    isPortable: appPaths.isPortable,
    appVersion: app.getVersion(),
    dataDir: appPaths.dataDir,
    modelsDir: models.getModelsDir(),
    writableEnginesDir: appPaths.writableEnginesDir,
  }));

  ipcMain.handle('engines:download', async (_e, backend: ActiveBackend) => {
    await engineDownloader.downloadBackend(backend);
    const updatedHw = await getHardware(true);
    // If a model is already active or installed, automatically restart engine to use newly installed accelerator
    const settings = store.getSettings();
    if (settings.activeModelId) {
      const activeModel = models.getInstalledModelById(settings.activeModelId);
      if (activeModel) {
        void engine.start(activeModel, settings, updatedHw);
      }
    }
    return updatedHw;
  });

  ipcMain.handle('engines:cancel-download', (_e, backend: ActiveBackend) => {
    engineDownloader.cancel(backend);
  });

  ipcMain.handle('system:open-models-folder', async () => {
    const dir = models.getModelsDir();
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('system:read-clipboard', () => clipboard.readText());
  ipcMain.handle('system:write-clipboard', (_e, text: string) => {
    clipboard.writeText(text);
  });

  // --- Settings ---
  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => {
    const prev = store.getSettings();
    const updated = store.updateSettings(patch);
    let shortcutRegistered = true;

    if (patch.globalShortcut !== undefined && patch.globalShortcut !== prev.globalShortcut) {
      shortcutRegistered = onShortcutChanged(updated.globalShortcut);
    }

    // If engine parameters changed and engine is currently running, restart it with new settings
    const engineParamsChanged =
      patch.preferredBackend !== undefined ||
      patch.gpuLayers !== undefined ||
      patch.contextSize !== undefined ||
      patch.threads !== undefined ||
      patch.flashAttention !== undefined;

    if (engineParamsChanged && engine.getStatus().state === 'ready' && updated.activeModelId) {
      const activeModel = models.getInstalledModelById(updated.activeModelId);
      if (activeModel) {
        const hw = await getHardware();
        void engine.start(activeModel, updated, hw);
      }
    }

    return { settings: updated, shortcutRegistered };
  });

  ipcMain.handle('settings:choose-models-dir', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: '모델 저장 폴더 선택',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const newDir = result.filePaths[0];
    store.updateSettings({ modelsDir: newDir });
    return newDir;
  });

  // --- Models ---
  ipcMain.handle('models:catalog', () => models.getCatalog());
  ipcMain.handle('models:installed', () => models.listInstalledModels());
  ipcMain.handle('models:partial-bytes', (_e, modelId: string) => models.getPartialBytes(modelId));

  ipcMain.handle('models:download', async (_e, modelId: string) => {
    return models.downloadModel(modelId);
  });

  ipcMain.handle('models:pause-download', (_e, modelId: string) => {
    models.pauseDownload(modelId);
  });

  ipcMain.handle('models:cancel-download', (_e, modelId: string) => {
    models.cancelDownload(modelId);
  });

  ipcMain.handle('models:import-dialog', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: '로컬 GGUF 모델 파일 가져오기',
      filters: [{ name: 'GGUF Models', extensions: ['gguf'] }],
      properties: ['openFile'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return models.importLocalModel(result.filePaths[0]);
  });

  ipcMain.handle('models:import-path', (_e, filePath: string) => {
    return models.importLocalModel(filePath);
  });

  ipcMain.handle('models:delete', async (_e, modelId: string) => {
    if (engine.getStatus().activeModelId === modelId) {
      await engine.stop();
    }
    models.deleteModel(modelId);
    return models.listInstalledModels();
  });

  // --- Engine ---
  ipcMain.handle('engine:status', () => engine.getStatus());
  ipcMain.handle('engine:logs', () => engine.getRecentLogs());

  ipcMain.handle('engine:start', async (_e, modelId?: string) => {
    const settings = store.getSettings();
    const targetId = modelId ?? settings.activeModelId;
    if (!targetId) {
      throw new Error('실행할 모델이 선택되지 않았습니다.');
    }
    const model = models.getInstalledModelById(targetId);
    if (!model) {
      throw new Error(`설치된 모델을 찾을 수 없습니다: ${targetId}`);
    }
    if (settings.activeModelId !== model.id) {
      store.updateSettings({ activeModelId: model.id });
    }
    const hw = await getHardware();
    return engine.start(model, store.getSettings(), hw);
  });

  ipcMain.handle('engine:stop', async () => {
    translator.abortAll();
    await engine.stop();
    return engine.getStatus();
  });

  // --- Translation ---
  ipcMain.handle('translate:start', async (_e, request: TranslationRequest) => {
    const settings = store.getSettings();
    const glossary = store.getGlossary();
    const win = getWindow();

    await translator.translate(request, settings, glossary, (event) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('translate:stream', event);
      }

      if (event.type === 'done' && event.fullText.trim()) {
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          sourceLang: request.sourceLang,
          targetLang: request.targetLang,
          tone: request.tone,
          modelName: event.stats.modelName ?? 'Local LLM',
          sourceText: request.text,
          translatedText: event.fullText,
          tokensPerSec: event.stats.tokensPerSec,
        };
        store.addHistory(entry);
      }
    });
  });

  ipcMain.handle('translate:abort', (_e, requestId: string) => {
    translator.abort(requestId);
  });

  // --- File Translation (.txt / .md) ---
  ipcMain.handle('files:open-text', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: '번역할 텍스트/마크다운 파일 열기',
      filters: [
        { name: 'Text & Markdown', extensions: ['txt', 'md', 'markdown', 'srt', 'csv', 'json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, content };
  });

  ipcMain.handle('files:save-text', async (_e, content: string, suggestedName?: string) => {
    const win = getWindow();
    const opts: Electron.SaveDialogOptions = {
      title: '번역 결과 저장',
      defaultPath: suggestedName ?? 'translated.md',
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    };
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, content, 'utf8');
    return result.filePath;
  });

  // --- Glossary ---
  ipcMain.handle('glossary:list', () => store.getGlossary());

  ipcMain.handle('glossary:save', (_e, entries: GlossaryEntry[]) => {
    return store.saveGlossary(entries);
  });

  ipcMain.handle('glossary:export', async () => {
    const win = getWindow();
    const opts: Electron.SaveDialogOptions = {
      title: '용어집 JSON 내보내기',
      defaultPath: 'local-translate-glossary.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(store.getGlossary(), null, 2), 'utf8');
    return result.filePath;
  });

  ipcMain.handle('glossary:import', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: '용어집 JSON 가져오기',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('올바른 용어집 JSON 배열 형식이 아닙니다.');
    }
    const existing = store.getGlossary();
    const merged: GlossaryEntry[] = [...existing];
    for (const item of parsed) {
      if (item && typeof item === 'object' && 'sourceTerm' in item && 'targetTerm' in item) {
        const rec = item as Partial<GlossaryEntry>;
        merged.push({
          id: rec.id || crypto.randomUUID(),
          sourceTerm: String(rec.sourceTerm ?? '').trim(),
          targetTerm: String(rec.targetTerm ?? '').trim(),
          sourceLang: rec.sourceLang || 'any',
          targetLang: rec.targetLang || 'any',
          enabled: rec.enabled ?? true,
          note: rec.note ? String(rec.note) : undefined,
        });
      }
    }
    return store.saveGlossary(merged);
  });

  // --- History ---
  ipcMain.handle('history:list', () => store.getHistory());
  ipcMain.handle('history:delete', (_e, id: string) => store.deleteHistory(id));
  ipcMain.handle('history:clear', () => {
    store.clearHistory();
    return [];
  });
}
