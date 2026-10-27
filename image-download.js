const http = require('node:http');
const https = require('node:https');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function imageExtension(data) {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
  if (data.length >= 13 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii')) && data.readUInt16LE(6) > 0 && data.readUInt16LE(8) > 0) return '.gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  throw new Error('URLの内容が対応する画像ではありません。PNG / JPEG / WebP / GIF画像への直接URLを指定してください。');
}

function parseImageUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('画像のURLを正しく入力してください。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('認証情報を含まない http / https の画像URLを指定してください。');
  }
  return url;
}

function downloadImage(value, { maxBytes = MAX_IMAGE_BYTES, timeoutMs = 30000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { request?.destroy(); reject(error); }
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('画像の取得がタイムアウトしました。URLとネット接続を確認してください。')), timeoutMs);
    const visit = (target, remaining) => {
      let url;
      try { url = parseImageUrl(target); }
      catch (error) { finish(error); return; }
      const transport = url.protocol === 'https:' ? https : http;
      request = transport.get(url, {
        headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif', 'User-Agent': 'DiscordCSV2ASS' },
      }, (response) => {
        response.on('error', (error) => finish(new Error(`画像を受信できませんでした: ${error.message}`)));
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          response.destroy();
          if (!location || remaining <= 0) { finish(new Error('画像URLの転送先を取得できませんでした。')); return; }
          try { visit(new URL(location, url).href, remaining - 1); }
          catch (error) { finish(error); }
          return;
        }
        if (response.statusCode !== 200) {
          response.destroy();
          finish(new Error(`画像を取得できませんでした（HTTP ${response.statusCode}）。URLの有効期限や公開状態を確認してください。`));
          return;
        }
        if (Number(response.headers['content-length']) > maxBytes) {
          response.destroy();
          finish(new Error('画像は1ファイル20MB以下にしてください。'));
          return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            finish(new Error('画像は1ファイル20MB以下にしてください。'));
          } else chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const data = Buffer.concat(chunks);
            finish(null, { data, extension: imageExtension(data) });
          } catch (error) { finish(error); }
        });
      });
      request.on('error', (error) => finish(new Error(`画像を取得できませんでした: ${error.message}`)));
    };
    visit(value, maxRedirects);
  });
}

module.exports = { downloadImage, imageExtension, parseImageUrl, MAX_IMAGE_BYTES };
