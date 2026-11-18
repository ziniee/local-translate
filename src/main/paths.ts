import fs from 'node:fs';
import path from 'node:path';

export interface ResolvedAppPaths {
  isPortable: boolean;
  dataDir: string;
  defaultModelsDir: string;
  writableEnginesDir: string;
  bundledEnginesDir: string;
  engineSearchDirs: string[];
}

export interface PathDetectionInput {
  isPackaged: boolean;
  exePath: string;
  resourcesPath: string;
  appPath: string;
  userDataPath: string;
  portableExecutableDir?: string;
  forcePortableEnv?: string;
}

/**
 * Resolves portable vs installed data & engine directories.
 * Portable mode activates automatically when:
 * 1. Running as an electron-builder portable executable (PORTABLE_EXECUTABLE_DIR is set), OR
 * 2. `portable.flag` or a `data/` directory exists alongside `LocalTranslate.exe` (packaged mode), OR
 * 3. `LOCAL_TRANSLATE_PORTABLE=1` environment variable is set.
 */
export function resolveAppPaths(input: PathDetectionInput): ResolvedAppPaths {
  const exeDir = path.dirname(input.exePath);

  let portableBaseDir: string | null = null;
  if (input.portableExecutableDir && input.portableExecutableDir.trim()) {
    portableBaseDir = path.resolve(input.portableExecutableDir);
  } else if (input.forcePortableEnv === '1') {
    portableBaseDir = input.isPackaged ? exeDir : input.appPath;
  } else if (input.isPackaged) {
    const flagPath = path.join(exeDir, 'portable.flag');
    const dataPath = path.join(exeDir, 'data');
    if (fs.existsSync(flagPath) || fs.existsSync(dataPath)) {
      portableBaseDir = exeDir;
    }
  }

  const isPortable = portableBaseDir !== null;
  const dataDir = isPortable ? path.join(portableBaseDir!, 'data') : input.userDataPath;
  const defaultModelsDir = path.join(dataDir, 'models');
  const writableEnginesDir = path.join(dataDir, 'engines');
  const bundledEnginesDir = input.isPackaged
    ? path.join(input.resourcesPath, 'engines')
    : path.join(input.appPath, 'resources', 'engines');

  const engineSearchDirs =
    path.resolve(writableEnginesDir).toLowerCase() === path.resolve(bundledEnginesDir).toLowerCase()
      ? [writableEnginesDir]
      : [writableEnginesDir, bundledEnginesDir];

  return {
    isPortable,
    dataDir,
    defaultModelsDir,
    writableEnginesDir,
    bundledEnginesDir,
    engineSearchDirs,
  };
}
