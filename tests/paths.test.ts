import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAppPaths } from '../src/main/paths';
import { LocalStorageStore } from '../src/main/storage';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('resolveAppPaths (Portable vs Installed)', () => {
  it('activates portable mode when portable.flag exists beside packaged exe', () => {
    const fakePortableRoot = makeTempDir('lt-portable-');
    fs.writeFileSync(path.join(fakePortableRoot, 'portable.flag'), '1', 'utf8');

    const resolved = resolveAppPaths({
      isPackaged: true,
      exePath: path.join(fakePortableRoot, 'LocalTranslate.exe'),
      resourcesPath: path.join(fakePortableRoot, 'resources'),
      appPath: path.join(fakePortableRoot, 'resources', 'app.asar'),
      userDataPath: 'C:\\Users\\Test\\AppData\\Roaming\\local-translate',
    });

    expect(resolved.isPortable).toBe(true);
    expect(resolved.dataDir).toBe(path.join(fakePortableRoot, 'data'));
    expect(resolved.defaultModelsDir).toBe(path.join(fakePortableRoot, 'data', 'models'));
    expect(resolved.writableEnginesDir).toBe(path.join(fakePortableRoot, 'data', 'engines'));
    expect(resolved.engineSearchDirs).toEqual([
      path.join(fakePortableRoot, 'data', 'engines'),
      path.join(fakePortableRoot, 'resources', 'engines'),
    ]);
  });

  it('activates portable mode when PORTABLE_EXECUTABLE_DIR env var is set', () => {
    const portableDir = makeTempDir('lt-portable-env-');
    const resolved = resolveAppPaths({
      isPackaged: true,
      exePath: 'C:\\Temp\\extracted\\LocalTranslate.exe',
      resourcesPath: 'C:\\Temp\\extracted\\resources',
      appPath: 'C:\\Temp\\extracted\\resources\\app.asar',
      userDataPath: 'C:\\Users\\Test\\AppData\\Roaming\\local-translate',
      portableExecutableDir: portableDir,
    });

    expect(resolved.isPortable).toBe(true);
    expect(resolved.dataDir).toBe(path.join(portableDir, 'data'));
  });

  it('uses standard AppData userData in installed mode when no portable marker exists', () => {
    const installDir = makeTempDir('lt-installed-');
    const userData = 'C:\\Users\\Test\\AppData\\Roaming\\local-translate';
    const resolved = resolveAppPaths({
      isPackaged: true,
      exePath: path.join(installDir, 'LocalTranslate.exe'),
      resourcesPath: path.join(installDir, 'resources'),
      appPath: path.join(installDir, 'resources', 'app.asar'),
      userDataPath: userData,
    });

    expect(resolved.isPortable).toBe(false);
    expect(resolved.dataDir).toBe(userData);
    expect(resolved.writableEnginesDir).toBe(path.join(userData, 'engines'));
  });

  it('keeps portable settings path-agnostic when moved between PCs/drives', () => {
    const dataDir = makeTempDir('lt-portable-store-');
    const store = new LocalStorageStore(dataDir, true);
    store.updateSettings({ defaultTargetLang: 'en' });

    const rawSettings = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'),
    ) as { modelsDir: string };
    expect(rawSettings.modelsDir).toBe('');

    const loaded = store.getSettings();
    expect(loaded.modelsDir).toBe(path.join(dataDir, 'models'));
  });
});
