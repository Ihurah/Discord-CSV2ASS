const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadImage, imageExtension, parseImageUrl, MAX_IMAGE_BYTES } = require('./image-download');

const EXTENSIONS = ['.png', '.jpg', '.webp', '.gif'];

async function resolveBundledConfig(filename, { downloadMissing = false, refresh = false } = {}) {
  const config = JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(config.emojis) || config.emojis.length > 1000) {
    throw new Error(`${filename}: emojis 配列を指定してください（最大1000件）。`);
  }
  const directory = path.dirname(filename);
  const resolved = [];
  const urls = new Map();
  for (const mapping of config.emojis) {
    if (!mapping || typeof mapping.text !== 'string' || !mapping.text.trim() || mapping.text.trim().length > 200 || /[\r\n]/.test(mapping.text)) {
      throw new Error(`${filename}: 対応する文字列が不正です。`);
    }
    if (!Object.prototype.hasOwnProperty.call(mapping, 'url')) {
      resolved.push(mapping);
      continue;
    }
    if (typeof mapping.url !== 'string' || !mapping.url.trim()) throw new Error(`${filename}: 画像の url を指定してください。`);
    const url = parseImageUrl(mapping.url).href;
    if (!urls.has(url)) {
      const stem = 'url-' + crypto.createHash('sha256').update(url).digest('hex');
      let relative;
      for (const extension of EXTENSIONS) {
        const candidate = `images/${stem}${extension}`;
        try {
          const stat = await fs.stat(path.join(directory, candidate));
          if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) continue;
          const data = await fs.readFile(path.join(directory, candidate));
          if (imageExtension(data) === extension) { relative = candidate; break; }
        } catch (error) {
          if (error.code && error.code !== 'ENOENT') throw error;
        }
      }
      if (refresh || !relative) {
        if (!downloadMissing) throw new Error(`${filename}: ${mapping.text} のURL画像が未取得です。npm run fetch-youtube-emojis を実行してください。`);
        const image = await downloadImage(url);
        relative = `images/${stem}${image.extension}`;
        const destination = path.join(directory, relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
        try {
          await fs.writeFile(temporary, image.data);
          await fs.rename(temporary, destination);
        } finally { await fs.rm(temporary, { force: true }); }
        // A refreshed URL may now return GIF instead of PNG (or vice versa).
        for (const extension of EXTENSIONS) {
          if (extension !== image.extension) await fs.rm(path.join(directory, 'images', stem + extension), { force: true });
        }
      }
      urls.set(url, relative);
    }
    resolved.push({ ...mapping, file: urls.get(url) });
  }
  return { ...config, emojis: resolved };
}

module.exports = { resolveBundledConfig };
