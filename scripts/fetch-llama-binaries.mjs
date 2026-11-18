/**
 * Downloads official prebuilt Windows x64 llama.cpp binaries (CUDA 12.4, Vulkan, CPU)
 * into resources/engines/{cuda,vulkan,cpu}/ and keeps only llama-server.exe + required DLLs
 * so the packaged Windows installer stays lean while supporting CUDA -> Vulkan -> CPU fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const enginesDir = path.join(root, 'resources', 'engines');
const tmpDir = path.join(root, 'resources', '.tmp-downloads');

const KEEP_EXTENSIONS = new Set(['.dll']);
const KEEP_EXECUTABLES = new Set(['llama-server.exe']);

function getGitHubHeaders() {
  const headers = { 'User-Agent': 'LocalTranslate-Fetcher' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: getGitHubHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function downloadFile(url, dest) {
  console.log(`  ↓ Downloading ${path.basename(dest)}...`);
  const res = await fetch(url, {
    headers: getGitHubHeaders(),
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length') || 0);
  const out = fs.createWriteStream(dest);
  let downloaded = 0;
  let lastLog = 0;

  for await (const chunk of res.body) {
    out.write(chunk);
    downloaded += chunk.length;
    const now = Date.now();
    if (total > 0 && now - lastLog > 1500) {
      const pct = ((downloaded / total) * 100).toFixed(1);
      process.stdout.write(`\r    ${pct}% (${(downloaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)`);
      lastLog = now;
    }
  }
  await new Promise((resolve, reject) => {
    out.end();
    out.on('finish', resolve);
    out.on('error', reject);
  });
  if (total > 0) {
    process.stdout.write(`\r    100.0% (${(downloaded / 1048576).toFixed(1)} MB)\n`);
  }
}

function extractZip(zipPath, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  );
}

function flattenAndPrune(dir) {
  // Move nested files up if extracted into a subfolder, and keep only llama-server.exe + *.dll
  const collected = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        collected.push(full);
      }
    }
  }
  walk(dir);

  const kept = [];
  for (const file of collected) {
    const base = path.basename(file);
    const lower = base.toLowerCase();
    const ext = path.extname(lower);
    if (KEEP_EXECUTABLES.has(lower) || KEEP_EXTENSIONS.has(ext)) {
      const dest = path.join(dir, base);
      if (path.resolve(file) !== path.resolve(dest)) {
        fs.copyFileSync(file, dest);
      }
      kept.push(base);
    }
  }

  // Remove everything in dir except kept files
  const keptSet = new Set(kept.map((n) => n.toLowerCase()));
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() || !keptSet.has(entry.name.toLowerCase())) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
  return kept;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const wantedBackends = args.size > 0
    ? [...args].filter((a) => ['cuda', 'vulkan', 'cpu'].includes(a))
    : ['cuda', 'vulkan', 'cpu'];

  console.log(`[fetch-engines] Looking up latest llama.cpp Windows release...`);
  const releases = await fetchJson('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10');
  const release = releases.find((r) =>
    Array.isArray(r.assets) && r.assets.some((a) => /bin-win-cpu-x64\.zip$/i.test(a.name)),
  );
  if (!release) {
    throw new Error('Could not find a llama.cpp release with Windows x64 binaries.');
  }
  console.log(`[fetch-engines] Selected release: ${release.tag_name}`);

  const findAsset = (regex) => release.assets.find((a) => regex.test(a.name));
  const manifest = {
    releaseTag: release.tag_name,
    fetchedAt: new Date().toISOString(),
    backends: {},
  };

  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(enginesDir, { recursive: true });

  const jobs = {
    cuda: [
      findAsset(/llama-.*-bin-win-cuda-12\.4-x64\.zip$/i),
      findAsset(/cudart-llama-bin-win-cuda-12\.4-x64\.zip$/i),
    ],
    vulkan: [findAsset(/llama-.*-bin-win-vulkan-x64\.zip$/i)],
    cpu: [findAsset(/llama-.*-bin-win-cpu-x64\.zip$/i)],
  };

  for (const backend of wantedBackends) {
    const assets = (jobs[backend] || []).filter(Boolean);
    if (assets.length === 0) {
      console.warn(`[fetch-engines] Skipping ${backend}: no matching assets found.`);
      continue;
    }
    const targetDir = path.join(enginesDir, backend);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });

    console.log(`\n[fetch-engines] Installing ${backend.toUpperCase()} backend...`);
    for (const asset of assets) {
      const zipPath = path.join(tmpDir, asset.name);
      if (!fs.existsSync(zipPath)) {
        await downloadFile(asset.browser_download_url, zipPath);
      } else {
        console.log(`  ✓ Using cached ${asset.name}`);
      }
      extractZip(zipPath, targetDir);
    }

    const kept = flattenAndPrune(targetDir);
    const totalBytes = kept.reduce(
      (sum, f) => sum + fs.statSync(path.join(targetDir, f)).size,
      0,
    );
    manifest.backends[backend] = {
      files: kept,
      sizeMB: Number((totalBytes / 1048576).toFixed(1)),
    };
    console.log(`  ✓ ${backend.toUpperCase()} ready: ${kept.length} files (${manifest.backends[backend].sizeMB} MB)`);
  }

  fs.writeFileSync(
    path.join(enginesDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\n[fetch-engines] Done! Saved manifest to resources/engines/manifest.json');
}

main().catch((err) => {
  console.error('[fetch-engines] Error:', err);
  process.exit(1);
});
