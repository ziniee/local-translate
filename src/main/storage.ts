import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, GlossaryEntry, HistoryEntry, InstalledModel } from '../shared/types';

export interface StoredCustomModel {
  id: string;
  name: string;
  filePath: string;
  addedAt: string;
}

export class LocalStorageStore {
  private readonly baseDir: string;
  private readonly isPortable: boolean;
  private readonly settingsFile: string;
  private readonly glossaryFile: string;
  private readonly historyFile: string;
  private readonly customModelsFile: string;

  constructor(dataDir: string, isPortable = false) {
    this.baseDir = dataDir;
    this.isPortable = isPortable;
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.settingsFile = path.join(this.baseDir, 'settings.json');
    this.glossaryFile = path.join(this.baseDir, 'glossary.json');
    this.historyFile = path.join(this.baseDir, 'history.json');
    this.customModelsFile = path.join(this.baseDir, 'custom-models.json');
  }

  getDefaultModelsDir(): string {
    return path.join(this.baseDir, 'models');
  }

  getDefaultSettings(): AppSettings {
    return {
      preferredBackend: 'auto',
      gpuLayers: 99,
      contextSize: 8192,
      threads: 0,
      temperature: 0.2,
      flashAttention: true,
      cachePrompt: true,
      chunkSize: 1000,
      preserveCodeBlocks: true,
      globalShortcut: 'Alt+Shift+T',
      minimizeToTray: true,
      modelsDir: this.getDefaultModelsDir(),
      activeModelId: null,
      defaultSourceLang: 'auto',
      defaultTargetLang: 'ko',
      defaultTone: 'natural',
    };
  }

  private readJson<T>(filePath: string, fallback: T): T {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(filePath: string, data: unknown): void {
    const tmp = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  getSettings(): AppSettings {
    const defaults = this.getDefaultSettings();
    const saved = this.readJson<Partial<AppSettings>>(this.settingsFile, {});
    const merged: AppSettings = { ...defaults, ...saved };

    // In portable mode, if modelsDir is empty or points to a stale drive/path from another PC,
    // transparently resolve to the portable data/models directory next to the executable.
    if (
      !merged.modelsDir ||
      (this.isPortable && !fs.existsSync(merged.modelsDir))
    ) {
      merged.modelsDir = this.getDefaultModelsDir();
    }
    return merged;
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch };
    const toPersist: Partial<AppSettings> = { ...next };
    // Avoid hardcoding absolute portable modelsDir path so USB/folder moves stay portable
    if (
      this.isPortable &&
      path.resolve(next.modelsDir).toLowerCase() ===
        path.resolve(this.getDefaultModelsDir()).toLowerCase()
    ) {
      toPersist.modelsDir = '';
    }
    this.writeJson(this.settingsFile, toPersist);
    return next;
  }

  getGlossary(): GlossaryEntry[] {
    return this.readJson<GlossaryEntry[]>(this.glossaryFile, []);
  }

  saveGlossary(entries: GlossaryEntry[]): GlossaryEntry[] {
    this.writeJson(this.glossaryFile, entries);
    return entries;
  }

  getHistory(): HistoryEntry[] {
    return this.readJson<HistoryEntry[]>(this.historyFile, []);
  }

  addHistory(entry: HistoryEntry): HistoryEntry[] {
    const current = this.getHistory();
    const next = [entry, ...current].slice(0, 200);
    this.writeJson(this.historyFile, next);
    return next;
  }

  deleteHistory(id: string): HistoryEntry[] {
    const next = this.getHistory().filter((item) => item.id !== id);
    this.writeJson(this.historyFile, next);
    return next;
  }

  clearHistory(): void {
    this.writeJson(this.historyFile, []);
  }

  getCustomModels(): StoredCustomModel[] {
    return this.readJson<StoredCustomModel[]>(this.customModelsFile, []);
  }

  saveCustomModels(models: StoredCustomModel[]): void {
    this.writeJson(this.customModelsFile, models);
  }

  resolveCustomInstalledModels(): InstalledModel[] {
    const saved = this.getCustomModels();
    const existing: InstalledModel[] = [];
    for (const item of saved) {
      if (fs.existsSync(item.filePath)) {
        const stat = fs.statSync(item.filePath);
        existing.push({
          id: item.id,
          name: item.name,
          filename: path.basename(item.filePath),
          filePath: item.filePath,
          sizeBytes: stat.size,
          isCustom: true,
          addedAt: item.addedAt,
        });
      }
    }
    return existing;
  }
}
