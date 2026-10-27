const path = require('node:path');
const { resolveBundledConfig } = require('../bundled-emojis');

async function main() {
  const filename = path.join(__dirname, '..', 'assets', 'youtube', 'emoji-map.json');
  const config = await resolveBundledConfig(filename, {
    downloadMissing: true,
    refresh: process.argv.includes('--refresh'),
  });
  console.log(`YouTube emoji images ready: ${config.emojis.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
