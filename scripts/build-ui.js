const path = require('node:path');
const fs = require('node:fs/promises');
const esbuild = require('esbuild');

esbuild.build({
  absWorkingDir: path.join(__dirname, '..'),
  entryPoints: ['renderer/workspace.jsx'],
  outfile: 'assets/ui/fluent-shell.js',
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome126',
  jsx: 'automatic',
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
}).then(async () => {
  const root = path.join(__dirname, '..');
  const directory = path.join(root, 'assets', 'ui', 'licenses');
  await fs.mkdir(directory, { recursive: true });
  for (const [source, filename] of [
    ['node_modules/react/LICENSE', 'react.txt'],
    ['node_modules/react-dom/LICENSE', 'react-dom.txt'],
    ['node_modules/scheduler/LICENSE', 'scheduler.txt'],
    ['node_modules/@fluentui/react-components/LICENSE', 'fluent-ui.txt'],
    ['assets/licenses/fluent-system-icons.txt', 'fluent-system-icons.txt'],
  ]) await fs.copyFile(path.join(root, source), path.join(directory, filename));
  console.log('Fluent UI workspace built.');
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
