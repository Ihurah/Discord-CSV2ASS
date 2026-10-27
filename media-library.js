const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadImage, parseImageUrl, MAX_IMAGE_BYTES } = require('./image-download');
const { resolveBundledConfig } = require('./bundled-emojis');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function normalizeText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 200 || /[\r\n]/.test(text)) {
    throw new Error('置換する文字列を1〜200文字で指定してください。');
  }
  return text;
}

class MediaLibrary {
  constructor(directory, nativeImage) {
    this.directory = directory;
    this.nativeImage = nativeImage;
    this.entries = [];
    this.bundledEntries = [];
  }

  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const entries = JSON.parse(await fs.readFile(path.join(this.directory, 'index.json'), 'utf8'));
      if (!Array.isArray(entries)) throw new Error('Invalid emoji library');
      this.entries = entries;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  assetPath(entry) {
    if (entry.bundledPath) return entry.bundledPath;
    if (!/^[a-f0-9-]+\.(png|jpe?g|webp|gif)$/.test(entry.file)) {
      throw new Error('Invalid emoji asset filename');
    }
    return path.join(this.directory, entry.file);
  }

  async list() {
    return Promise.all(this.getEntries().map(async (entry) => ({
      id: entry.id, text: entry.text,
      url: typeof entry.url === 'string' ? entry.url : '',
      source: entry.source || 'custom',
      youtube: this.bundledEntries.some((preset) => preset.source === 'youtube' && preset.text === entry.text),
      bundled: Boolean(entry.bundledPath),
      preview: `data:image/${path.extname(entry.file).slice(1)};base64,${(await fs.readFile(this.assetPath(entry))).toString('base64')}`,
    })));
  }

  getEntries() {
    const merged = new Map(this.bundledEntries.map((entry) => [entry.text, entry]));
    this.entries.forEach((entry) => merged.set(entry.text, entry));
    return [...merged.values()];
  }

  async loadBundledConfig(filename, source = 'bundled') {
    const config = await resolveBundledConfig(filename);
    const directory = path.dirname(filename);
    const prepared = [];
    for (const mapping of config.emojis) {
      const text = typeof mapping.text === 'string' ? mapping.text.trim() : '';
      if (!text || text.length > 200 || /[\r\n]/.test(text)) throw new Error(`${filename}: 対応する文字列が不正です。`);
      if (typeof mapping.file !== 'string') throw new Error(`${filename}: 画像の file を指定してください。`);
      const bundledPath = path.resolve(directory, mapping.file);
      const relative = path.relative(directory, bundledPath);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`${filename}: 同梱画像は設定ファイルと同じフォルダー内へ配置してください。`);
      const extension = path.extname(bundledPath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`${filename}: PNG / JPEG / WebP / GIFを指定してください。`);
      const stat = await fs.stat(bundledPath);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error(`${filename}: 画像は1ファイル20MB以下にしてください。`);
      prepared.push({
        id: 'bundled-' + crypto.createHash('sha256').update(filename + '\0' + text).digest('hex'),
        text, file: path.basename(bundledPath), bundledPath, source,
        ...(mapping.url ? { url: parseImageUrl(mapping.url).href } : {}),
      });
    }
    this.bundledEntries.push(...prepared);
  }

  async persist(entries) {
    const destination = path.join(this.directory, 'index.json');
    const temporary = destination + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(entries, null, 2), 'utf8');
    await fs.rename(temporary, destination);
    this.entries = entries;
  }

  async importMappings(mappings) {
    const prepared = [];
    for (const mapping of mappings) {
      const text = normalizeText(mapping.text);
      const extension = Buffer.isBuffer(mapping.data) ? mapping.extension : path.extname(mapping.file).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('PNG / JPEG / WebP / GIFを指定してください。');
      if (!Buffer.isBuffer(mapping.data)) {
        const stat = await fs.stat(mapping.file);
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('画像は1ファイル20MB以下にしてください。');
      }
      const data = Buffer.isBuffer(mapping.data) ? mapping.data : await fs.readFile(mapping.file);
      if (data.length > MAX_IMAGE_BYTES) throw new Error('画像は1ファイル20MB以下にしてください。');
      const gif = extension === '.gif' && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii')) && data.length >= 13 && data.readUInt16LE(6) > 0 && data.readUInt16LE(8) > 0;
      const webp = extension === '.webp' && data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
      // Electron nativeImage does not decode GIF/WebP on every platform.
      if (!gif && !webp && this.nativeImage.createFromBuffer(data).isEmpty()) throw new Error('画像を読み込めませんでした。');
      const id = crypto.randomUUID();
      const url = mapping.url ? parseImageUrl(mapping.url).href : '';
      prepared.push({ id, text, file: id + extension, data, url });
    }
    const entries = [...this.entries];
    for (const item of prepared) {
      await fs.writeFile(this.assetPath(item), item.data);
      const index = entries.findIndex((entry) => entry.text === item.text);
      const entry = { id: item.id, text: item.text, file: item.file, ...(item.url ? { url: item.url } : {}) };
      if (index === -1) entries.push(entry);
      else entries[index] = entry;
    }
    const obsolete = this.entries.filter((old) => !entries.some((entry) => entry.id === old.id));
    await this.persist(entries);
    await Promise.all(obsolete.map((entry) => fs.rm(this.assetPath(entry), { force: true })));
    return this.list();
  }

  async importUrl(text, url) {
    const normalized = normalizeText(text);
    const sourceUrl = parseImageUrl(url).href;
    const image = await downloadImage(sourceUrl);
    return this.importMappings([{ text: normalized, ...image, url: sourceUrl }]);
  }

  async remove(id) {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return this.list();
    await this.persist(this.entries.filter((item) => item.id !== id));
    await fs.rm(this.assetPath(entry), { force: true });
    return this.list();
  }
}

module.exports = { MediaLibrary };
