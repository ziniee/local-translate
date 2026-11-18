import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  Menu,
  nativeImage,
  Tray,
} from 'electron';
import { detectHardware } from './hardware';
import { EngineDownloader } from './engineDownloader';
import { EngineManager } from './engineManager';
import { ModelManager } from './modelManager';
import { resolveAppPaths } from './paths';
import { LocalStorageStore } from './storage';
import { TranslationService } from './translation/translator';
import { registerIpcHandlers } from './ipc';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let currentShortcut: string | null = null;

// Crisp inline SVG icon for window & Windows system tray (zero external asset failures)
const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="28">LT</text>
</svg>`;

function createAppIcon(): Electron.NativeImage {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(APP_ICON_SVG).toString('base64')}`;
  return nativeImage.createFromDataURL(dataUrl);
}

const appPaths = resolveAppPaths({
  isPackaged: app.isPackaged,
  exePath: app.getPath('exe'),
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  userDataPath: app.getPath('userData'),
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  forcePortableEnv: process.env.LOCAL_TRANSLATE_PORTABLE,
});

// Keep Electron cache/profile inside portable data folder when running in portable mode
if (appPaths.isPortable) {
  app.setPath('userData', path.join(appPaths.dataDir, 'electron-profile'));
}

// Enforce single instance on Windows
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const store = new LocalStorageStore(appPaths.dataDir, appPaths.isPortable);
const engine = new EngineManager(appPaths.engineSearchDirs);
const engineDownloader = new EngineDownloader(appPaths.writableEnginesDir);
const models = new ModelManager(store);
const translator = new TranslationService(engine);

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function triggerClipboardQuickTranslate(): void {
  const clipText = clipboard.readText().trim();
  showMainWindow();
  if (clipText && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system:quick-translate', clipText);
  }
}

function registerGlobalTranslateShortcut(accelerator: string): boolean {
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut);
    } catch {
      // ignore
    }
    currentShortcut = null;
  }
  const trimmed = accelerator.trim();
  if (!trimmed) return true;
  try {
    const ok = globalShortcut.register(trimmed, triggerClipboardQuickTranslate);
    if (ok) currentShortcut = trimmed;
    return ok;
  } catch {
    return false;
  }
}

function setupTray(): void {
  const icon = createAppIcon().resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('LocalTranslate — 오프라인 로컬 LLM 번역기');

  const menu = Menu.buildFromTemplate([
    { label: 'LocalTranslate 열기', click: () => showMainWindow() },
    { label: '클립보드 즉시 번역', click: () => triggerClipboardQuickTranslate() },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => showMainWindow());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b0f19',
    icon: createAppIcon(),
    title: 'LocalTranslate',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', (event) => {
    const settings = store.getSettings();
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function autoStartActiveModel(): Promise<void> {
  const settings = store.getSettings();
  const installed = models.listInstalledModels();
  if (installed.length === 0) return;

  const target =
    (settings.activeModelId && installed.find((m) => m.id === settings.activeModelId)) ||
    installed[0];

  if (target) {
    if (settings.activeModelId !== target.id) {
      store.updateSettings({ activeModelId: target.id });
    }
    const hw = await detectHardware(appPaths.engineSearchDirs);
    if (hw.availableEngines.length > 0) {
      void engine.start(target, store.getSettings(), hw);
    }
  }
}

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(() => {
  registerIpcHandlers({
    getWindow: () => mainWindow,
    appPaths,
    store,
    engine,
    engineDownloader,
    models,
    translator,
    onShortcutChanged: registerGlobalTranslateShortcut,
  });

  createWindow();
  setupTray();

  const settings = store.getSettings();
  registerGlobalTranslateShortcut(settings.globalShortcut);

  void autoStartActiveModel();
});

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    isQuitting = true;
  }
  globalShortcut.unregisterAll();
  if (engine.getStatus().state !== 'stopped') {
    event.preventDefault();
    translator.abortAll();
    await engine.stop();
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
