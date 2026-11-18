import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function buildMainAndPreload() {
  const sharedOptions = {
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: true,
    external: ['electron'],
  };
  await Promise.all([
    esbuild.build({
      ...sharedOptions,
      entryPoints: [path.join(root, 'src/main/index.ts')],
      outfile: path.join(root, 'dist/main/index.cjs'),
    }),
    esbuild.build({
      ...sharedOptions,
      entryPoints: [path.join(root, 'src/preload/index.ts')],
      outfile: path.join(root, 'dist/preload/index.cjs'),
    }),
  ]);
}

const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
});
await server.listen();
const addr = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173';
console.log(`[dev] Vite renderer running at ${addr}`);

await buildMainAndPreload();

const electronBin = process.platform === 'win32'
  ? path.join(root, 'node_modules/.bin/electron.cmd')
  : path.join(root, 'node_modules/.bin/electron');

const child = spawn(electronBin, ['.'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: addr,
  },
});

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
