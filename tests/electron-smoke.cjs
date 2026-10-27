// Run with: node_modules/.bin/electron tests/electron-smoke.cjs
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const Module = require('node:module');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csv2ass-ui-test-'));
electron.app.setPath('userData', path.join(directory, 'profile'));
electron.app.disableHardwareAcceleration();
const video = path.join(directory, 'source.mp4');
const image = path.join(directory, 'stamp.gif');
const ffmpeg = require('ffmpeg-static');
for (const args of [
  ['-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', video],
  ['-f', 'lavfi', '-i', 'testsrc=s=32x32:r=4:d=1', '-loop', '0', image],
]) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
  assert.equal(result.status, 0, result.stderr.toString());
}
let openPath = image;
let savePath = path.join(directory, 'comments.ass');
let cancelSave = false;
let capturedBurnPlan;
let capturedSaveOptions;
const originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
electron.ipcMain.handle = (channel, handler) => originalHandle(channel, (event, ...args) => {
  if (channel === 'burn-video') capturedBurnPlan = args[0];
  return handler(event, ...args);
});
const imageServer = http.createServer((request, response) => {
  if (request.url.startsWith('/stamp')) response.writeHead(200, { 'Content-Type': 'image/gif' }).end(fs.readFileSync(image));
  else response.end('<html>Not an image</html>');
});
const imageServerReady = new Promise((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openPath] });
electron.dialog.showSaveDialog = async (window, options) => { capturedSaveOptions = options; return { canceled: cancelSave, filePath: savePath }; };
electron.dialog.showMessageBoxSync = () => 1;
const actualLoad = Module._load;
const facade = { ...electron, BrowserWindow: class extends electron.BrowserWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false, offscreen: true } }); }
} };
Module._load = function (name, ...args) {
  return name === 'electron' ? facade : actualLoad.call(this, name, ...args);
};
let failed = false;
const timeout = setTimeout(() => { console.error('UI smoke test timed out'); electron.app.exit(1); }, 90000);
electron.app.on('browser-window-created', (event, window) => {
  window.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) console.error('Renderer:', message);
  });
  window.webContents.once('did-finish-load', async () => {
    try {
      const run = (code) => window.webContents.executeJavaScript(code);
      const captureScreen = async (name) => {
        if (!process.argv.includes('--screenshots')) return;
        const folder = path.join(__dirname, '..', 'dist', 'test-artifacts');
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, `${name}.png`), (await window.webContents.capturePage()).toPNG());
      };
      const showTab = async (name) => {
        await run(`document.getElementById('tab-${name}').click(); new Promise(resolve => setTimeout(resolve, 200))`);
        await run(`document.getAnimations().forEach(animation => { try { animation.finish(); } catch {} });`);
        assert.equal(await run(`document.getElementById('tab-${name}').getAttribute('aria-selected')`), 'true');
        assert.equal(await run(`document.getElementById('panel-${name}').hidden`), false);
        assert.equal(await run(`document.querySelector('.preview-side').hidden`), ['emoji', 'burn'].includes(name));
        if (name === 'preview') {
          assert.equal(await run(`getComputedStyle(document.getElementById('val_bg_color')).marginRight`), '0px');
        }
        if (name === 'burn') {
          assert.ok(await run(`(() => {
            const layout = document.querySelector('.layout-burn').getBoundingClientRect();
            const page = document.getElementById('panel-burn').getBoundingClientRect();
            return Math.abs(page.width - layout.width) < 1;
          })()`), 'Burn settings should fill the space without a preview column');
        }
      };
      await imageServerReady;
      await run(`window.alerts = []; window.alert = (text) => alerts.push(text); MediaUI.ready`);
      assert.equal(await run(`document.getElementById('fluent-root').dataset.ready`), 'true');
      assert.equal(await run(`document.querySelectorAll('.workspace-nav [role="tab"]').length`), 4);
      assert.equal(await run(`document.querySelector('.workspace-header, .workspace-footer, select[aria-label="表示テーマ"]')`), null);
      assert.equal(await run(`document.documentElement.dataset.uiTheme`), 'light');
      assert.equal(await run(`document.getElementById('val_burn_crf').tagName`), 'SELECT');
      assert.deepEqual(await run(`[...document.getElementById('val_burn_crf').options].map(option => option.value)`), ['18', '23', '28']);
      assert.equal(await run(`document.getElementById('val_burn_crf').value`), '18');
      assert.equal(await run(`document.getElementById('val_burn_encoder').value`), 'libx264');
      assert.deepEqual(await run(`[...document.getElementById('val_burn_fps').options].map(option => option.value)`), ['source', ...require('../video-frame-rates').choices]);
      assert.equal(await run(`document.getElementById('val_burn_fps').value`), '60');
      const encoders = await run('electronAPI.getVideoEncoders()');
      assert.deepEqual(await run(`[...document.getElementById('val_burn_encoder').options].map(option => option.value).sort()`), encoders.filter(encoding => encoding.available).map(encoding => encoding.id).sort());
      assert.ok(await run(`[...document.querySelectorAll('#val_burn_encoder optgroup')].every(group => group.children.length > 0)`));
      await run(`window.originalFileInput = document.getElementById('csv_file'); window.originalFontInput = document.getElementById('val_font'); document.getElementById('tab-appearance').click();`);
      assert.equal(await run(`document.getElementById('settings-appearance').hidden`), false);
      assert.equal(await run(`getComputedStyle(document.querySelector('.layout-settings .preview-side')).position`), 'static');
      assert.ok(await run(`(async () => {
        const scroll = document.querySelector('.workspace-scroll');
        const preview = document.querySelector('.preview-side');
        const before = preview.getBoundingClientRect().top;
        scroll.scrollTop = 120;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const distance = scroll.scrollTop;
        const moved = before - preview.getBoundingClientRect().top;
        scroll.scrollTop = 0;
        return distance >= 100 && Math.abs(moved - distance) < 1;
      })()`), 'Settings preview must scroll with the settings instead of sticking');
      await run(`document.getElementById('tab-basic').click();`);
      await showTab('emoji');
      assert.equal(await run(`document.querySelector('button[data-action="import_emoji"]')`), null);
      assert.ok(await run(`(() => {
        const list = document.querySelector('#panel-emoji .emoji-list');
        const body = document.getElementById('emoji_list');
        const scroll = document.querySelector('.workspace-scroll');
        const rows = Array.from({ length: 20 }, () => {
          const row = document.createElement('tr');
          row.style.height = '60px';
          const cell = document.createElement('td');
          cell.colSpan = 3;
          cell.textContent = 'Layout test';
          row.append(cell);
          return row;
        });
        try {
          body.append(...rows);
          const style = getComputedStyle(list);
          return style.maxHeight === 'none' && style.overflowY === 'visible'
            && list.clientHeight > 520 && list.scrollHeight <= list.clientHeight + 1
            && scroll.scrollHeight > scroll.clientHeight;
        } finally { rows.forEach(row => row.remove()); }
      })()`), 'Long emoji lists must expand and use the page scrollbar');
      assert.equal(await run(`document.querySelector('.preview-side').hidden`), true);
      assert.equal(await run(`document.getElementById('val_emoji_source').value`), 'url');
      assert.notEqual(await run(`getComputedStyle(document.getElementById('emoji_url')).display`), 'none');
      assert.notEqual(await run(`getComputedStyle(document.getElementById('add_emoji_url')).display`), 'none');
      assert.equal(await run(`getComputedStyle(document.getElementById('add_emoji')).display`), 'none');
      await run(`document.getElementById('val_emoji_source').value = 'file'; document.getElementById('val_emoji_source').dispatchEvent(new Event('change'));`);
      assert.equal(await run(`getComputedStyle(document.getElementById('emoji_url')).display`), 'none');
      assert.equal(await run(`getComputedStyle(document.getElementById('add_emoji_url')).display`), 'none');
      assert.notEqual(await run(`getComputedStyle(document.getElementById('add_emoji')).display`), 'none');
      await run(`document.getElementById('val_emoji_source').value = 'url'; document.getElementById('val_emoji_source').dispatchEvent(new Event('change'));`);
      assert.notEqual(await run(`getComputedStyle(document.getElementById('emoji_url')).display`), 'none');
      assert.notEqual(await run(`getComputedStyle(document.getElementById('add_emoji_url')).display`), 'none');
      assert.equal(await run(`getComputedStyle(document.getElementById('add_emoji')).display`), 'none');
      assert.equal(await run(`JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')).emoji_source`), 'url');
      await run(`document.getElementById('val_emoji_source').value = 'file'; document.getElementById('val_emoji_source').dispatchEvent(new Event('change'));`);
      assert.ok(await run(`document.fonts.check('32px "Noto Color Emoji"')`));
      assert.ok(await run(`[...document.fonts].some(face => face.family === 'Noto Color Emoji' && face.status === 'loaded')`));
      assert.ok(await run(`getComputedStyle(document.querySelector('#emoji_sample .unicode-emoji')).fontFamily.startsWith('"Noto Color Emoji"')`));
      assert.equal(await run(`(() => {
        const glyph = String.fromCodePoint(0x1f34e);
        const expected = document.createElement('canvas');
        expected.width = expected.height = 256;
        const context = expected.getContext('2d');
        context.font = '218px "Noto Color Emoji", sans-serif';
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText(glyph, 128, 135, 250);
        window.notoEmojiImage = expected.toDataURL('image/png');
        const rendered = MediaUI.layout(glyph, 'MS PGothic', 45, true).runs[0];
        return rendered.type === 'image';
      })()`), true);
      await showTab('settings');
      assert.ok(await run(`document.getElementById('preview_box').getBoundingClientRect().height >= 200`));
      assert.ok(await run(`document.getElementById('csv_file') === originalFileInput && document.getElementById('val_font') === originalFontInput`));
      await showTab('emoji');
      assert.equal(await run(`document.getElementById('emoji_sample_input').value`), ':smile:');
      assert.equal(await run(`document.getElementById('emoji_sample').textContent`), String.fromCodePoint(0x1f604));
      assert.ok(await run(`document.getElementById('emoji_heading').textContent.includes('Discord')`));
      const baseline = await run(`electronAPI.getEmojiSettings().then(result => result.entries.filter(entry => !(entry.bundled && entry.source === 'youtube')).length)`);
      const totalBaseline = await run(`electronAPI.getEmojiSettings().then(result => result.entries.length)`);
      assert.equal(await run(`document.getElementById('emoji_count').textContent`), `登録済み ${baseline}件`);
      assert.equal(await run(`document.querySelectorAll('.emoji-entry').length`), baseline);
      await run(`
        window.emojiBaseline = ${baseline};
        window.emojiRow = (token) => [...document.querySelectorAll('.emoji-entry')].find(row => row.querySelector('span').textContent === token);
        window.until = async (check) => {
          const deadline = Date.now() + 30000;
          while (!check()) { if (Date.now() > deadline) throw Error('Timed out waiting for UI'); await new Promise(resolve => setTimeout(resolve, 50)); }
        };
        document.getElementById('emoji_token').value = ':custom:';
        document.querySelector('button[data-action="add_emoji"]').click();
        until(() => document.querySelectorAll('.emoji-entry').length === emojiBaseline + 1 && document.getElementById('emoji_token').value === '');
      `);
      assert.equal(await run(`electronAPI.getEmojiSettings().then(result => result.entries.length)`), totalBaseline + 1);
      await showTab('preview');
      for (const id of ['preview_text', 'preview_modal_text']) {
        assert.equal(await run(`document.getElementById('${id}').querySelectorAll('img').length`), 2);
        assert.equal(await run(`document.getElementById('${id}').querySelectorAll('img[alt="' + String.fromCodePoint(0x1f604) + '"]').length`), 0);
        await run(`until(() => [...document.getElementById('${id}').querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0))`);
        assert.equal(await run(`document.getElementById('${id}').textContent.replace(/\\s/g, '')`), 'サンプルテキストここに表示されます88888888');
      }
      await run(`document.getElementById('open_preview_modal').click();`);
      assert.ok(await run(`document.getElementById('preview_modal_text').getBoundingClientRect().width > 0`));
      await captureScreen('fluent-expanded-preview');
      await run(`document.getElementById('close_preview_modal').click();`);
      await run(`document.getElementById('check_bold').checked = false; document.getElementById('val_op_all').value = 50; updatePreview();`);
      assert.equal(await run(`getComputedStyle(document.querySelector('#preview_text .preview-emoji')).opacity`), '0.5');
      assert.equal(await run(`getComputedStyle(document.querySelector('#preview_shadow_text .preview-emoji')).visibility`), 'hidden');
      await run(`document.getElementById('check_bold').checked = true; updatePreview();`);
      assert.equal(await run(`getComputedStyle(document.getElementById('preview_text')).opacity`), '0.5');
      assert.equal(await run(`getComputedStyle(document.querySelector('#preview_text .preview-emoji')).opacity`), '1');
      await run(`document.getElementById('val_op_all').value = 80; updatePreview();`);
      const customizedPreview = '<img src=x onerror="window.previewInjected=true"> PREVIEW_ONLY\n\n:smile: :custom: :face-blue-smiling:';
      await run(`document.getElementById('val_preview_text').value = ${JSON.stringify(customizedPreview)}; document.getElementById('val_preview_text').dispatchEvent(new Event('input'));`);
      await showTab('emoji');
      for (const id of ['preview_text', 'preview_modal_text']) {
        assert.equal(await run(`document.getElementById('${id}').querySelectorAll('br').length`), 2);
        assert.equal(await run(`document.getElementById('${id}').querySelectorAll('img').length`), 3);
        assert.ok(await run(`document.getElementById('${id}').textContent.includes('<img src=x')`));
        assert.ok(await run(`document.getElementById('${id}').textContent.includes('PREVIEW_ONLY')`));
      }
      assert.equal(await run(`Boolean(window.previewInjected)`), false);
      assert.equal(await run(`JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')).preview_text`), customizedPreview);
      await run(`document.getElementById('val_preview_text').value = ''; document.getElementById('val_preview_text').dispatchEvent(new Event('input'));`);
      assert.equal(await run(`document.querySelectorAll('#preview_text img, #preview_modal_text img').length`), 0);
      assert.equal(await run(`JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')).preview_text`), '');
      await run(`document.getElementById('reset_preview_text').click(); until(() => document.getElementById('val_preview_text').value.startsWith('サンプルテキスト'))`);
      assert.equal(await run(`document.getElementById('val_preview_text').value.includes(':smile:')`), false);
      assert.equal(await run(`document.querySelectorAll('#preview_text img, #preview_modal_text img').length`), 4);
      assert.equal(await run(`JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')).preview_text`), await run(`document.getElementById('val_preview_text').value`));
      await run(`document.getElementById('val_preview_text').value = ${JSON.stringify(customizedPreview)}; document.getElementById('val_preview_text').dispatchEvent(new Event('input'));`);
      await run(`
        document.getElementById('emoji_token').value = ':second:';
        document.getElementById('emoji_url').value = 'https://unused.example/stale.png';
        document.getElementById('emoji_token').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        until(() => document.querySelectorAll('.emoji-entry').length === emojiBaseline + 2 && document.getElementById('emoji_token').value === '');
      `);
      assert.equal(await run(`document.getElementById('emoji_count').textContent`), `登録済み ${baseline + 2}件`);
      await run(`
        emojiRow(':second:').querySelector('.danger').click();
        until(() => document.querySelectorAll('.emoji-entry').length === emojiBaseline + 1);
      `);
      await run(`
        window.previousEmojiId = emojiRow(':custom:').dataset.emojiId;
        emojiRow(':custom:').querySelector('button').click();
        until(() => emojiRow(':custom:').dataset.emojiId !== previousEmojiId);
      `);
      assert.equal(await run(`electronAPI.getEmojiSettings().then(result => result.entries.length)`), totalBaseline + 1);
      await run(`
        window.beforeUrlId = emojiRow(':custom:').dataset.emojiId;
        emojiRow(':custom:').querySelector('button[aria-label$="の画像をURLから取得"]').click();
      `);
      assert.equal(await run(`document.getElementById('val_emoji_source').value`), 'url');
      assert.equal(await run(`document.getElementById('emoji_token').value`), ':custom:');
      assert.equal(await run(`document.getElementById('emoji_url').value`), '');
      assert.notEqual(await run(`getComputedStyle(document.getElementById('emoji_url')).display`), 'none');
      await run(`
        document.getElementById('emoji_url').value = 'http://127.0.0.1:${imageServer.address().port}/stamp?signature=example';
        document.getElementById('add_emoji_url').click();
        until(() => emojiRow(':custom:').dataset.emojiId !== beforeUrlId && document.getElementById('emoji_url').value === '' && !document.getElementById('add_emoji_url').disabled);
      `);
      assert.ok(await run(`electronAPI.getEmojiSettings().then(result => result.entries.find(entry => entry.text === ':custom:').preview.startsWith('data:image/gif;'))`));
      await run(`emojiRow(':custom:').querySelector('button[aria-label$="の画像をURLから取得"]').click();`);
      assert.equal(await run(`document.getElementById('emoji_url').value`), `http://127.0.0.1:${imageServer.address().port}/stamp?signature=example`);
      const editedUrl = `http://127.0.0.1:${imageServer.address().port}/stamp?signature=edited`;
      await run(`window.beforeUrlEditId = emojiRow(':custom:').dataset.emojiId;
        document.getElementById('emoji_url').value = ${JSON.stringify(editedUrl)};
        document.getElementById('add_emoji_url').click();
        until(() => emojiRow(':custom:').dataset.emojiId !== beforeUrlEditId && document.getElementById('emoji_url').value === '' && !document.getElementById('add_emoji_url').disabled);`);
      assert.equal(await run(`electronAPI.getEmojiSettings().then(result => result.entries.find(entry => entry.text === ':custom:').url)`), editedUrl);
      await run(`
        document.getElementById('emoji_token').value = ':bad_url:';
        document.getElementById('emoji_url').value = 'http://127.0.0.1:${imageServer.address().port}/page';
        document.getElementById('add_emoji_url').click();
        until(() => document.getElementById('emoji_status').textContent.includes('直接URL') && !document.getElementById('add_emoji_url').disabled);
      `);
      assert.equal(await run(`document.getElementById('emoji_token').value`), ':bad_url:');
      assert.equal(await run(`electronAPI.getEmojiSettings().then(result => result.entries.length)`), totalBaseline + 1);
      await run(`document.getElementById('emoji_token').value = ''; document.getElementById('emoji_url').value = '';`);
      assert.equal(await run(`Boolean(emojiRow(':face-blue-smiling:'))`), false);
      await run(`
        document.getElementById('emoji_token').value = ':face-blue-smiling:';
        document.getElementById('emoji_url').value = 'http://127.0.0.1:${imageServer.address().port}/stamp';
        document.getElementById('add_emoji_url').click();
        until(() => emojiRow(':face-blue-smiling:')?.querySelector('img').src.startsWith('data:image/gif;') && document.getElementById('emoji_token').value === '');
      `);
      assert.equal(await run(`document.getElementById('emoji_count').textContent`), `登録済み ${baseline + 2}件`);
      assert.ok(await run(`document.querySelector('#preview_text .preview-emoji[alt=":face-blue-smiling:"]').src.startsWith('data:image/gif;')`));
      await run(`
        emojiRow(':face-blue-smiling:').querySelector('.danger').click();
        until(() => !emojiRow(':face-blue-smiling:'));
      `);
      assert.equal(await run(`document.getElementById('emoji_count').textContent`), `登録済み ${baseline + 1}件`);
      assert.ok(await run(`document.querySelector('#preview_text .preview-emoji[alt=":face-blue-smiling:"]').src.startsWith('data:image/png;')`));
      assert.equal(await run(`document.querySelectorAll('#preview_text img, #preview_modal_text img').length`), 6);
      assert.equal(await run(`document.getElementById('val_preview_text').value`), customizedPreview);
      imageServer.closeAllConnections();
      await new Promise(resolve => imageServer.close(resolve));
      await showTab('burn');
      await run(`document.getElementById('val_burn_fps').value = 'source'; document.getElementById('val_burn_encoder').value = 'mpeg2video'; document.getElementById('val_burn_encoder').dispatchEvent(new Event('change', { bubbles: true }));`);
      assert.equal(await run(`document.querySelector('#val_burn_fps option[value="source"]').disabled`), true);
      assert.equal(await run(`document.getElementById('burn_video').disabled`), true);
      await run(`document.getElementById('val_burn_encoder').value = 'libx264'; document.getElementById('val_burn_encoder').dispatchEvent(new Event('change', { bubbles: true }));`);
      assert.equal(await run(`document.querySelector('#val_burn_fps option[value="source"]').disabled`), false);
      assert.ok(await run(`(() => {
        const selects = ['burn-resolution', 'val_burn_encoder', 'val_burn_fps', 'val_burn_crf', 'val_burn_preset'].map(id => document.getElementById(id));
        const reference = selects[1].getBoundingClientRect();
        const referenceStyle = getComputedStyle(selects[1]);
        return selects.every(select => {
          const rect = select.getBoundingClientRect();
          const style = getComputedStyle(select);
          const card = select.closest('.workspace-card').getBoundingClientRect();
          return Math.abs(rect.left - reference.left) < 1
            && Math.abs(rect.right - reference.right) < 1
            && Math.abs(rect.height - reference.height) < 1
            && rect.right <= card.right
            && ['appearance', 'borderRadius', 'border', 'padding', 'fontSize'].every(property => style[property] === referenceStyle[property]);
        });
      })()`), 'All output selects must share the same appearance and dimensions');
      await run(`document.getElementById('burn-resolution').value = '2560x1440'; document.getElementById('burn-resolution').dispatchEvent(new Event('change', { bubbles: true }));`);
      assert.equal(await run(`document.getElementById('val_resolution').value`), '2560x1440');
      assert.equal(await run(`JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')).resolution`), '2560x1440');
      openPath = video;
      await run(`document.querySelector('button[data-action="choose_burn_video"]').click(); until(() => document.getElementById('burn_video_name').textContent === 'source.mp4')`);
      await run(String.raw`(async () => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['Date,Content\n2026-10-25T00:00:00,BEFORE_START\n2026-10-25T01:00:01,Hello :apple: :custom: :face-blue-smiling: world\n'], 'comments.csv', { type: 'text/csv' }));
        document.getElementById('csv_file').files = transfer.files;
        document.getElementById('val_time').value = '01:00:00';
        document.getElementById('val_resolution').value = '1280x720';
        document.getElementById('val_burn_fps').value = '59.94';
        document.getElementById('val_burn_fps').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('val_burn_crf').value = '23';
        document.getElementById('val_burn_crf').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('val_burn_preset').value = 'fast';
        await generateASS();
      })()`);
      const ass = fs.readFileSync(savePath, 'utf8');
      assert.ok(ass.includes('\u{1f34e}'));
      assert.ok(ass.includes(':custom:'));
      assert.ok(ass.includes(':face-blue-smiling:'));
      assert.ok(!ass.includes('BEFORE_START'));
      assert.ok(!ass.includes('PREVIEW_ONLY'), 'Custom preview text must not be exported as a comment');
      assert.equal(await run(`document.getElementById('val_time').value`), '01:00:00');
      await showTab('settings');
      assert.equal(await run(`document.getElementById('csv_file').files[0].name`), 'comments.csv');
      await showTab('burn');
      assert.equal(await run(`document.getElementById('val_burn_crf').value`), '23');
      assert.equal(await run(`JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')).burn_crf`), '23');
      assert.equal(await run(`document.getElementById('burn_video_name').textContent`), 'source.mp4');
      savePath = path.join(directory, 'burned.mp4');
      await run(`document.querySelector('button[data-action="burn_video"]').click(); until(() => document.getElementById('burn_status').textContent.startsWith('保存しました'))`);
      assert.ok(fs.statSync(savePath).size > 1000);
      assert.equal(capturedBurnPlan.unicodeImages['unicode-1f34e'], await run('notoEmojiImage'), 'Video export must use the bundled Noto emoji rendering');
      assert.equal(capturedBurnPlan.crf, 23);
      assert.equal(capturedBurnPlan.preset, 'fast');
      assert.equal(capturedBurnPlan.encoder, 'libx264');
      assert.equal(capturedBurnPlan.fps, '59.94');
      assert.deepEqual(capturedSaveOptions.filters[0].extensions, ['mp4']);
      assert.equal(await run(`document.getElementById('burn_progress').value`), 100);
      const frame = path.join(directory, 'burn-frame.png');
      const capture = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', savePath, '-frames:v', '1', frame], { windowsHide: true });
      assert.equal(capture.status, 0, capture.stderr.toString());
      for (const [encoder, extension, lossless, fps] of [['ffv1', 'mkv', true, 'source'], ['libvpx-vp9', 'webm', false, '120']]) {
        await run(`document.getElementById('val_burn_encoder').value = '${encoder}'; document.getElementById('val_burn_encoder').dispatchEvent(new Event('change', { bubbles: true }));`);
        await run(`document.getElementById('val_burn_fps').value = '${fps}'; document.getElementById('val_burn_fps').dispatchEvent(new Event('change', { bubbles: true }));`);
        assert.equal(await run(`document.getElementById('val_burn_crf').disabled`), lossless);
        assert.equal(await run(`document.getElementById('val_burn_preset').disabled`), lossless);
        assert.ok(await run(`document.querySelector('button[data-action="burn_video"]').textContent.includes('${extension.toUpperCase()}')`));
        assert.equal(await run(`JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')).burn_encoder`), encoder);
        savePath = path.join(directory, `burned.${extension}`);
        await run(`document.querySelector('button[data-action="burn_video"]').click(); until(() => document.getElementById('burn_status').textContent.startsWith('保存しました'))`);
        assert.ok(fs.statSync(savePath).size > 1000);
        assert.equal(capturedBurnPlan.encoder, encoder);
        assert.equal(capturedBurnPlan.fps, fps);
        assert.deepEqual(capturedSaveOptions.filters[0].extensions, [extension]);
        assert.ok(capturedSaveOptions.defaultPath.endsWith(`.${extension}`));
      }
      cancelSave = true;
      await run(`document.getElementById('burn_video').click(); until(() => document.getElementById('burn_status').textContent === '中止しました。')`);
      assert.equal(await run(`document.getElementById('burn_video').disabled`), false);
      assert.deepEqual(await run('alerts'), [await run('alerts[0]')]);
      const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
      window.webContents.reload();
      await reloaded;
      await run('MediaUI.ready');
      assert.equal(await run(`document.getElementById('val_preview_text').value`), customizedPreview);
      assert.equal(await run(`document.querySelectorAll('#preview_text img, #preview_modal_text img').length`), 6);
      assert.ok(await run(`document.getElementById('preview_text').textContent.includes('PREVIEW_ONLY')`));
      assert.equal(await run(`document.getElementById('tab-burn').getAttribute('aria-selected')`), 'true');
      assert.equal(await run(`document.getElementById('val_burn_crf').value`), '23');
      assert.equal(await run(`document.getElementById('val_burn_encoder').value`), 'libvpx-vp9');
      assert.equal(await run(`document.getElementById('val_burn_fps').value`), '120');
      await showTab('emoji');
      await run(`window.emojiRow = (token) => [...document.querySelectorAll('.emoji-entry')].find(row => row.querySelector('span').textContent === token); emojiRow(':custom:').querySelector('button[aria-label$="の画像をURLから取得"]').click();`);
      assert.equal(await run(`document.getElementById('emoji_url').value`), editedUrl);
      await showTab('burn');
      await run(`document.getElementById('reset_preview_text').click(); new Promise(resolve => setTimeout(resolve, 200))`);
      for (const tab of ['settings', 'preview', 'emoji', 'burn']) {
        await showTab(tab);
        await captureScreen(`fluent-${tab}`);
        if (tab === 'settings') {
          await run(`document.getElementById('tab-appearance').click(); new Promise(resolve => setTimeout(resolve, 200))`);
          await captureScreen('fluent-appearance');
          await run(`document.getElementById('tab-basic').click();`);
        }
      }
      await run(`const settings = JSON.parse(localStorage.getItem('discord-csv2ass-settings-v2')); settings.burn_crf = '20'; settings.burn_encoder = 'unavailable-old-encoder'; localStorage.setItem('discord-csv2ass-settings-v2', JSON.stringify(settings)); localStorage.setItem('discord-csv2ass-ui-theme', 'dark');`);
      const migrated = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
      window.webContents.reload();
      await migrated;
      await run('MediaUI.ready');
      assert.equal(await run(`document.getElementById('val_burn_crf').value`), '18');
      assert.equal(await run(`document.documentElement.dataset.uiTheme`), 'light');
      assert.equal(await run(`document.getElementById('val_burn_encoder').value`), 'libx264');
      assert.ok(await run(`document.getElementById('burn_encoding_info').textContent.includes('以前のエンコーダーが利用できない')`));
      console.log('PASS: Fluent tabs, encoder capabilities/persistence, MP4/WebM/MKV dialogs and exports, emoji previews and settings');
    } catch (error) {
      failed = true;
      console.error(error);
    } finally {
      clearTimeout(timeout);
      imageServer.closeAllConnections();
      imageServer.close();
      window.destroy();
      electron.app.exit(failed ? 1 : 0);
    }
  });
});
const packagedApp = process.env.CSV2ASS_TEST_PACKAGE || path.join(__dirname, '..', 'dist', 'Discord CSV2ASS-win32-x64');
require(process.argv.includes('--packaged') ? path.join(packagedApp, 'resources', 'app.asar', 'main.js') : '../main');
Module._load = actualLoad;
