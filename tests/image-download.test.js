const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { downloadImage } = require('../image-download');
const { MediaLibrary } = require('../media-library');
const { resolveBundledConfig } = require('../bundled-emojis');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function fixture(action) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request);
    const name = request.url.split('?')[0];
    if (name === '/redirect') response.writeHead(302, { Location: '/animation?ex=signed' }).end();
    else if (name === '/loop') response.writeHead(302, { Location: '/loop' }).end();
    else if (name === '/bad-redirect') response.writeHead(302, { Location: 'file:///C:/secret.png' }).end();
    else if (name === '/animation') response.writeHead(200, { 'Content-Type': 'image/gif' }).end(gif);
    else if (name === '/image') response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(png);
    else if (name === '/page') response.end('<html>Not an image</html>');
    else if (name === '/large-header') response.writeHead(200, { 'Content-Length': String(21 * 1024 * 1024) }).end();
    else if (name === '/large-stream') { response.write(Buffer.alloc(20)); response.end(Buffer.alloc(20)); }
    else if (name === '/stall') return;
    else response.writeHead(403).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await action(base, requests); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('downloads extensionless images and follows signed GIF redirects without changing bytes', async () => {
  await fixture(async (base, requests) => {
    const animated = await downloadImage(base + '/redirect');
    assert.equal(animated.extension, '.gif');
    assert.deepEqual(animated.data, gif);
    const image = await downloadImage(base + '/image?format=png');
    assert.equal(image.extension, '.png');
    assert.deepEqual(image.data, png);
    assert.ok(requests.some((request) => request.url === '/animation?ex=signed'));
    assert.ok(requests.every((request) => !request.headers.cookie && !request.headers.authorization));
  });
});

test('rejects invalid URLs, non-images, expired URLs, oversized downloads and redirect loops', async () => {
  await assert.rejects(downloadImage('not a url'), /URL/);
  await assert.rejects(downloadImage('file:///C:/image.png'), /http/);
  await assert.rejects(downloadImage('https://name:password@example.com/a.png'), /認証情報/);
  await fixture(async (base) => {
    await assert.rejects(downloadImage(base + '/page'), /直接URL/);
    await assert.rejects(downloadImage(base + '/expired'), /HTTP 403/);
    await assert.rejects(downloadImage(base + '/large-header'), /20MB/);
    await assert.rejects(downloadImage(base + '/large-stream', { maxBytes: 30 }), /20MB/);
    await assert.rejects(downloadImage(base + '/loop'), /転送/);
    await assert.rejects(downloadImage(base + '/bad-redirect'), /http/);
    await assert.rejects(downloadImage(base + '/stall', { timeoutMs: 80 }), /タイムアウト/);
  });
});

test('URL registration persists offline and a failed download preserves the existing image', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-url-test-'));
  const nativeImage = { createFromBuffer: () => ({ isEmpty: () => false }) };
  let expectedPreview;
  let expectedUrl;
  try {
    await fixture(async (base) => {
      const library = new MediaLibrary(directory, nativeImage);
      await library.load();
      await library.importUrl(':discord:', base + '/image');
      assert.equal((await library.list())[0].url, base + '/image');
      expectedUrl = base + '/animation?expires=example';
      await library.importUrl(':discord:', expectedUrl);
      assert.equal(library.entries.length, 1);
      assert.equal(path.extname(library.entries[0].file), '.gif');
      assert.deepEqual(await fs.readFile(library.assetPath(library.entries[0])), gif);
      expectedPreview = (await library.list())[0].preview;
      await assert.rejects(library.importUrl(':discord:', base + '/expired'), /HTTP 403/);
      assert.equal((await library.list())[0].preview, expectedPreview);
      assert.equal((await library.list())[0].url, expectedUrl);
    });
    const reloaded = new MediaLibrary(directory, nativeImage);
    await reloaded.load();
    assert.equal((await reloaded.list())[0].preview, expectedPreview);
    assert.equal((await reloaded.list())[0].url, expectedUrl);
    const localImage = path.join(directory, 'local.png');
    await fs.writeFile(localImage, png);
    await reloaded.importMappings([{ text: ':discord:', file: localImage }]);
    assert.equal((await reloaded.list())[0].url, '', 'Replacing from a local file must clear the previous source URL');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('developer URL presets cache images for offline runtime and refresh without corrupting the cache', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-bundled-url-test-'));
  const filename = path.join(directory, 'emoji-map.json');
  let resolved, baseUrl;
  try {
    await fs.writeFile(path.join(directory, 'local.png'), png);
    await fixture(async (base, requests) => {
      baseUrl = base;
      await fs.writeFile(filename, JSON.stringify({ emojis: [
        { text: ':youtube:', url: base + '/redirect', file: 'local.png' },
        { text: ':youtube_alias:', url: base + '/redirect' },
        { text: ':local:', file: 'local.png' },
      ] }));
      await assert.rejects(resolveBundledConfig(filename), /未取得/);
      assert.equal(requests.length, 0, 'Runtime must never download images');
      resolved = await resolveBundledConfig(filename, { downloadMissing: true });
      assert.equal(requests.length, 2, 'Aliases should share one downloaded image');
      assert.equal(resolved.emojis[0].file, resolved.emojis[1].file);
      assert.equal(path.extname(resolved.emojis[0].file), '.gif');
      assert.deepEqual(await fs.readFile(path.join(directory, resolved.emojis[0].file)), gif);
      await resolveBundledConfig(filename, { downloadMissing: true });
      assert.equal(requests.length, 2, 'A cached image should not be downloaded again');
      await resolveBundledConfig(filename, { downloadMissing: true, refresh: true });
      assert.equal(requests.length, 4, 'Explicit refresh must fetch the URL again');
    });
    const offline = await resolveBundledConfig(filename);
    assert.deepEqual(offline, resolved);
    const library = new MediaLibrary(path.join(directory, 'user-data'), { createFromBuffer: () => ({ isEmpty: () => false }) });
    await library.load();
    await library.loadBundledConfig(filename, 'youtube');
    assert.equal((await library.list())[0].source, 'youtube');
    await assert.rejects(resolveBundledConfig(filename, { downloadMissing: true, refresh: true }));
    assert.deepEqual(await fs.readFile(path.join(directory, resolved.emojis[0].file)), gif);
    await fs.writeFile(filename, JSON.stringify({ emojis: [{ text: ':youtube:', url: baseUrl + '/image' }] }));
    await assert.rejects(resolveBundledConfig(filename), /未取得/, 'A changed URL must not reuse the old URL image');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
