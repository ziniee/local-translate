/**
 * Builds distributable Windows packages for other PCs & GitHub Releases:
 *
 *   node scripts/build-dist.mjs portable               # Lightweight Portable folder + ZIP (Vulkan+CPU bundled, CUDA/Models on-demand)
 *   node scripts/build-dist.mjs portable --full        # Full Portable folder + ZIP (CUDA+Vulkan+CPU bundled)
 *   node scripts/build-dist.mjs portable --with-models # Also copies local .gguf models into data/models/
 *   node scripts/build-dist.mjs installer              # Windows NSIS installer .exe (Vulkan+CPU bundled, CUDA/Models on-demand)
 *   node scripts/build-dist.mjs installer --full       # Windows NSIS installer .exe (CUDA+Vulkan+CPU bundled)
 *   node scripts/build-dist.mjs github                 # GitHub Releases bundle: Portable ZIP + Setup EXE + SHA256SUMS.txt
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const mode = ['portable', 'installer', 'github'].includes(args[0]) ? args[0] : 'portable';
const isFull = args.includes('--full');
const withModels = args.includes('--with-models');

function run(cmd, cmdArgs, cwd = root) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd, ...cmdArgs], {
      cwd,
      stdio: 'inherit',
    });
  } else {
    execFileSync(cmd, cmdArgs, {
      cwd,
      stdio: 'inherit',
    });
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function writeChecksums(files) {
  const existing = files.filter((f) => f && fs.existsSync(f));
  if (existing.length === 0) return;
  const lines = existing.map((file) => `${sha256File(file)}  ${path.basename(file)}`);
  const outPath = path.join(root, 'release', 'SHA256SUMS.txt');
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`\n[build-dist] Wrote checksums -> ${outPath}`);
}

function find7za() {
  const pnpmDir = path.join(root, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('7zip-bin@')) {
        const candidate = path.join(pnpmDir, entry, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function writeTempBuilderConfig(configPath, extraConfig) {
  const includedEngines = isFull ? ['cuda', 'vulkan', 'cpu'] : ['vulkan', 'cpu'];
  const extraResources = [];

  for (const engine of includedEngines) {
    const engineDir = path.join(root, 'resources', 'engines', engine);
    if (fs.existsSync(engineDir)) {
      extraResources.push({
        from: `resources/engines/${engine}`,
        to: `engines/${engine}`,
        filter: ['**/*'],
      });
    } else {
      console.warn(`[build-dist] Warning: resources/engines/${engine} not found — skipping.`);
    }
  }

  const config = {
    appId: 'com.localtranslate.app',
    productName: 'LocalTranslate',
    copyright: 'Copyright © 2026 LocalTranslate',
    directories: {
      output: 'release',
      buildResources: 'build',
    },
    files: ['dist/**/*', 'package.json'],
    extraResources,
    asar: true,
    compression: 'normal',
    publish: null,
    win: {
      signAndEditExecutable: false,
      artifactName: `\${productName}-\${version}-\${arch}-${isFull ? 'full-' : ''}\${target}.\${ext}`,
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'LocalTranslate',
    },
    ...extraConfig,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function createPortableReadme(destDir) {
  const engineNote = isFull
    ? 'CUDA 12.4 / Vulkan / CPU 추론 엔진이 모두 내장되어 있습니다.'
    : 'Vulkan / CPU 추론 엔진이 기본 내장되어 있으며, NVIDIA GPU PC에서는 앱 내 [모델 관리]에서 CUDA 가속 엔진을 1클릭으로 추가 설치할 수 있습니다.';

  const text = `============================================================
  LocalTranslate v${pkg.version} — Windows 포터블 버전
============================================================

[실행 방법]
1. 이 폴더 전체를 원하는 위치(USB, 바탕화면, D:\\Tools 등)에 두고
   LocalTranslate.exe 를 실행하세요.
2. 별도 설치(관리자 권한 불필요)나 외부 API 키 없이 동작합니다.

[포터블 데이터 & 모델 관리]
- 모든 설정, 용어집, 번역 기록, 다운로드한 모델 및 추가 엔진은
  이 폴더 안의 data\\ 폴더에 저장됩니다.
- 최초 실행 시 [로컬 번역 모델 초기 설정] 화면에서 PC 사양에 맞는
  추천 모델(.gguf)을 1클릭으로 내려받으세요.
- 완전 오프라인 PC로 옮기려면 미리 받아둔 .gguf 모델 파일을
  data\\models\\ 폴더에 복사해 넣기만 하면 바로 인식됩니다.

[내장 추론 엔진]
- ${engineNote}

[기본 단축키]
- Ctrl + Enter : 번역 시작
- Alt + Shift + T : 클립보드 복사 텍스트 즉시 번역
`;
  fs.writeFileSync(path.join(destDir, '사용안내-README.txt'), text, 'utf8');
}

function copyInstalledModelsIfRequested(portableDataModelsDir) {
  if (!withModels) return;
  const appDataModels = path.join(os.homedir(), 'AppData', 'Roaming', 'local-translate', 'models');
  if (!fs.existsSync(appDataModels)) {
    console.warn(`[build-dist] No local models found at ${appDataModels}`);
    return;
  }
  const files = fs.readdirSync(appDataModels).filter((f) => f.toLowerCase().endsWith('.gguf'));
  for (const file of files) {
    console.log(`[build-dist] Copying model into portable bundle: ${file}`);
    fs.copyFileSync(path.join(appDataModels, file), path.join(portableDataModelsDir, file));
  }
}

function buildPortable(electronBuilderBin, tmpConfigPath) {
  const outFolderName = isFull ? 'LocalTranslate-Portable-Full' : 'LocalTranslate-Portable';
  const portableDir = path.join(root, 'release', outFolderName);
  const stagingOutDir = path.join(root, 'release', '.staging-portable');
  const unpackedDir = path.join(stagingOutDir, 'win-unpacked');

  fs.rmSync(stagingOutDir, { recursive: true, force: true });
  fs.rmSync(portableDir, { recursive: true, force: true });

  writeTempBuilderConfig(tmpConfigPath, {
    directories: {
      output: 'release/.staging-portable',
      buildResources: 'build',
    },
  });
  run(electronBuilderBin, ['--win', '--x64', '--dir', '--publish', 'never', '--config', tmpConfigPath]);

  fs.renameSync(unpackedDir, portableDir);
  fs.rmSync(stagingOutDir, { recursive: true, force: true });

  fs.writeFileSync(
    path.join(portableDir, 'portable.flag'),
    'Keep this file to store models, engines, glossary, and settings inside ./data/\n',
    'utf8',
  );
  const dataModelsDir = path.join(portableDir, 'data', 'models');
  const dataEnginesDir = path.join(portableDir, 'data', 'engines');
  fs.mkdirSync(dataModelsDir, { recursive: true });
  fs.mkdirSync(dataEnginesDir, { recursive: true });

  createPortableReadme(portableDir);
  copyInstalledModelsIfRequested(dataModelsDir);

  const zipName = `LocalTranslate-${pkg.version}-win-x64-portable${isFull ? '-full' : ''}${withModels ? '-with-models' : ''}.zip`;
  const zipPath = path.join(root, 'release', zipName);
  fs.rmSync(zipPath, { force: true });

  const sevenZip = find7za();
  if (sevenZip) {
    console.log(`\n[build-dist] Compressing portable package with 7-Zip -> ${zipName}`);
    execFileSync(sevenZip, ['a', '-tzip', '-mx=5', zipPath, portableDir], {
      stdio: 'inherit',
    });
  } else {
    console.log(`\n[build-dist] Compressing portable package with PowerShell -> ${zipName}`);
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${portableDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  }

  const zipSizeMB = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  console.log(`\n[build-dist] Portable package ready!`);
  console.log(`  Folder : ${portableDir}`);
  console.log(`  Archive: ${zipPath} (${zipSizeMB} MB)`);
  return zipPath;
}

function buildInstaller(electronBuilderBin, tmpConfigPath) {
  const stagingOutDir = path.join(root, 'release', '.staging-installer');
  fs.rmSync(stagingOutDir, { recursive: true, force: true });

  const installerFileName = `LocalTranslate-${pkg.version}-win-x64-${isFull ? 'full-' : ''}setup.exe`;
  writeTempBuilderConfig(tmpConfigPath, {
    directories: {
      output: 'release/.staging-installer',
      buildResources: 'build',
    },
    win: {
      signAndEditExecutable: false,
      target: [{ target: 'nsis', arch: ['x64'] }],
      artifactName: installerFileName,
    },
  });
  run(electronBuilderBin, ['--win', '--x64', '--publish', 'never', '--config', tmpConfigPath]);

  const builtInstaller = path.join(stagingOutDir, installerFileName);
  const finalInstaller = path.join(root, 'release', installerFileName);
  if (fs.existsSync(builtInstaller)) {
    fs.copyFileSync(builtInstaller, finalInstaller);
    const sizeMB = (fs.statSync(finalInstaller).size / 1048576).toFixed(1);
    console.log(`\n[build-dist] Windows NSIS installer ready!`);
    console.log(`  Installer: ${finalInstaller} (${sizeMB} MB)`);
  }
  fs.rmSync(stagingOutDir, { recursive: true, force: true });
  return finalInstaller;
}

async function main() {
  console.log(
    `[build-dist] Mode=${mode} | Profile=${isFull ? 'FULL (CUDA+Vulkan+CPU)' : 'LITE (Vulkan+CPU, CUDA on-demand)'} | WithModels=${withModels}`,
  );

  // 1. Build main, preload, renderer
  run('pnpm', ['build']);

  const electronBuilderBin = path.join(root, 'node_modules', '.bin', 'electron-builder.cmd');
  const tmpConfigPath = path.join(root, 'release', '.tmp-builder-config.json');
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });

  try {
    if (mode === 'installer') {
      const exe = buildInstaller(electronBuilderBin, tmpConfigPath);
      writeChecksums([exe]);
      return;
    }

    if (mode === 'github') {
      const zip = buildPortable(electronBuilderBin, tmpConfigPath);
      const exe = buildInstaller(electronBuilderBin, tmpConfigPath);
      writeChecksums([zip, exe]);
      return;
    }

    const zip = buildPortable(electronBuilderBin, tmpConfigPath);
    writeChecksums([zip]);
  } finally {
    fs.rmSync(tmpConfigPath, { force: true });
  }
}

main().catch((err) => {
  console.error('[build-dist] Failed:', err);
  process.exit(1);
});
