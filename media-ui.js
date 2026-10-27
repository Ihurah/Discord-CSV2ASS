(function () {
  const api = window.electronAPI;
  const state = { aliases: {}, entries: [], unicodeImages: {}, video: false, busy: false, libraryBusy: false, previewReady: false, previewCustomized: false, encoders: [], encodersReady: false };
  const byId = (id) => document.getElementById(id);
  let ready;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  const isUnicodeEmoji = (text) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text);
  const DEFAULT_PREVIEW_TEXT = 'サンプルテキスト\nここに表示されます\n88888888';

  async function loadEmojiFont() {
    const faces = await document.fonts.load('32px "Noto Color Emoji"');
    if (!faces.length) throw new Error('同梱のNoto Color Emojiフォントを読み込めませんでした。');
  }

  function tokenize(text) {
    return EmojiText.createTokenizer(byId('val_auto_emoji').checked ? state.aliases : {}, state.entries)(text);
  }

  function sample() {
    const destination = byId('emoji_sample');
    destination.replaceChildren();
    for (const run of tokenize(byId('emoji_sample_input').value)) {
      if (run.type === 'text') {
        for (const { segment } of segmenter.segment(run.text)) {
          if (isUnicodeEmoji(segment)) {
            const emoji = document.createElement('span');
            emoji.className = 'unicode-emoji';
            emoji.textContent = segment;
            destination.append(emoji);
          } else destination.append(document.createTextNode(segment));
        }
      }
      else {
        const image = document.createElement('img');
        image.src = state.entries.find((entry) => entry.id === run.id).preview;
        image.alt = run.text;
        destination.append(image);
      }
    }
  }

  function previewSample() {
    const lines = byId('val_preview_text').value.split(/\r?\n/);
    for (const id of ['preview_text', 'preview_modal_text']) {
      const destination = byId(id);
      destination.replaceChildren();
      const appendImage = (src, text) => {
        const image = document.createElement('img');
        image.className = 'preview-emoji';
        image.src = src;
        image.alt = text;
        image.title = text;
        destination.append(image);
      };
      lines.forEach((line, index) => {
        if (index > 0) destination.append(document.createElement('br'));
        for (const run of tokenize(line)) {
          if (run.type === 'image') {
            appendImage(state.entries.find((entry) => entry.id === run.id).preview, run.text);
          } else {
            for (const { segment } of segmenter.segment(run.text)) {
              if (isUnicodeEmoji(segment)) appendImage(state.unicodeImages[unicodeImage(segment)], segment);
              else destination.append(document.createTextNode(segment));
            }
          }
        }
      });
    }
    updatePreview();
  }

  function setDefaultPreviewText() {
    const lines = DEFAULT_PREVIEW_TEXT.split('\n');
    const youtube = state.entries.filter((entry) => entry.youtube || entry.source === 'youtube').slice(0, 2);
    if (youtube.length) lines[0] += ' ' + youtube.map((entry) => entry.text).join(' ');
    byId('val_preview_text').value = lines.join('\n');
    state.previewCustomized = true;
  }

  function listedEntries() {
    return state.entries.filter((entry) => !(entry.bundled && entry.source === 'youtube'));
  }

  function renderLibrary() {
    const entries = listedEntries();
    byId('emoji_list').replaceChildren();
    byId('emoji_count').textContent = `登録済み ${entries.length}件`;
    if (entries.length === 0) {
      const empty = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'emoji-empty';
      cell.textContent = 'まだ登録されていません。下の追加行からDiscord絵文字を追加できます。';
      empty.append(cell);
      byId('emoji_list').append(empty);
    }
    for (const entry of entries) {
      const row = document.createElement('tr');
      row.className = 'emoji-entry';
      row.dataset.emojiId = entry.id;
      const previewCell = document.createElement('td');
      const image = document.createElement('img');
      image.src = entry.preview;
      image.alt = entry.text;
      previewCell.append(image);
      const textCell = document.createElement('td');
      const text = document.createElement('span');
      text.textContent = entry.text;
      textCell.append(text);
      if (entry.bundled) {
        const origin = document.createElement('small');
        origin.className = 'emoji-origin';
        origin.textContent = entry.source === 'youtube' ? 'YouTube・開発者設定' : '開発者設定';
        textCell.append(origin);
      }
      const actionCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'emoji-row-actions';
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'btn-small';
      replace.textContent = entry.bundled ? '別画像で上書き' : '画像を変更';
      replace.disabled = state.busy || state.libraryBusy;
      replace.setAttribute('aria-label', `${entry.text} の画像を変更`);
      replace.addEventListener('click', () => changeLibrary(() => api.addEmojiImage(entry.text)));
      const replaceUrl = document.createElement('button');
      replaceUrl.type = 'button';
      replaceUrl.className = 'btn-small';
      replaceUrl.textContent = entry.bundled ? 'URLで上書き' : 'URLで変更';
      replaceUrl.disabled = state.busy || state.libraryBusy;
      replaceUrl.setAttribute('aria-label', `${entry.text} の画像をURLから取得`);
      replaceUrl.addEventListener('click', () => {
        byId('emoji_token').value = entry.text;
        byId('val_emoji_source').value = 'url';
        byId('val_emoji_source').dispatchEvent(new Event('change', { bubbles: true }));
        byId('emoji_url').value = entry.url || '';
        byId('emoji_status').textContent = entry.url
          ? 'URLを編集して「追加」を押すと更新できます。'
          : '取得元URLが保存されていないため、新しいURLを入力してください。';
        byId('emoji_url').scrollIntoView({ block: 'nearest' });
        byId('emoji_url').focus({ preventScroll: true });
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-small danger';
      remove.textContent = '削除';
      remove.setAttribute('aria-label', `${entry.text} を削除`);
      remove.disabled = state.busy || state.libraryBusy;
      remove.addEventListener('click', () => changeLibrary(() => api.removeEmojiImage(entry.id)));
      actions.append(replace, replaceUrl);
      if (!entry.bundled) actions.append(remove);
      actionCell.append(actions);
      row.append(previewCell, textCell, actionCell);
      byId('emoji_list').append(row);
    }
    sample();
    state.previewReady = true;
    if (!state.previewCustomized) {
      setDefaultPreviewText();
      saveSettings();
    }
    previewSample();
  }

  async function changeLibrary(action, message = '登録内容を更新しています…') {
    if (state.busy || state.libraryBusy) return false;
    state.libraryBusy = true;
    refreshControls();
    byId('emoji_status').textContent = message;
    try {
      await ready;
      const result = await action();
      if (result.canceled) { byId('emoji_status').textContent = 'キャンセルしました。'; return false; }
      state.entries = result.entries;
      renderLibrary();
      byId('emoji_status').textContent = `${listedEntries().length}件を登録しています。`;
      return true;
    } catch (error) {
      byId('emoji_status').textContent = error.message;
      return false;
    } finally {
      state.libraryBusy = false;
      refreshControls();
    }
  }

  function refreshControls() {
    const locked = state.busy || state.libraryBusy;
    for (const id of ['choose_burn_video', 'burn_video', 'add_emoji', 'add_emoji_url', 'emoji_token', 'emoji_url', 'val_emoji_source']) byId(id).disabled = locked;
    byId('cancel_burn').disabled = !state.busy;
    byId('emoji_list').querySelectorAll('button').forEach((button) => { button.disabled = locked; });
    const encoding = state.encoders.find((item) => item.id === byId('val_burn_encoder').value);
    byId('val_burn_encoder').disabled = locked || !state.encodersReady;
    byId('val_burn_crf').disabled = locked || Boolean(encoding?.lossless);
    byId('val_burn_preset').disabled = locked || !encoding?.supportsSpeed;
    byId('val_burn_fps').disabled = locked;
    byId('burn_video').disabled = locked || !encoding?.available || (byId('val_burn_fps').value === 'source' && !encoding.supportsSourceRate);
  }

  function updateEncoding(notice = '') {
    const encoding = state.encoders.find((item) => item.id === byId('val_burn_encoder').value);
    if (encoding) {
      byId('val_burn_fps').querySelector('option[value="source"]').disabled = !encoding.supportsSourceRate;
      const audio = encoding.extension === 'webm' ? 'Opus' : encoding.lossless ? 'FLAC' : 'AAC';
      const info = [`保存形式: ${encoding.extension.toUpperCase()} / 音声: ${audio}`];
      if (encoding.lossless) info.push('ロスレスのため画質・速度の設定は使いません。容量が大きくなります。');
      else if (!encoding.supportsSpeed) info.push('この方式ではエンコード速度の設定は使いません。');
      if (encoding.pixelFormat.includes('10') || encoding.pixelFormat.includes('12')) info.push('高ビット深度で保存します。SDR素材をHDRには変換しません。');
      if (!encoding.supportsSourceRate) info.push('MPEG-2/4は固定フレームレートを選択してください。');
      else if (byId('val_burn_fps').value === 'source') info.push('元動画のフレーム時刻を引き継ぎます（可変fpsも維持）。');
      if (notice) info.push(notice);
      byId('burn_encoding_info').textContent = info.join(' ');
      byId('burn_video').textContent = `${encoding.extension.toUpperCase()}を生成して保存`;
    }
    refreshControls();
  }

  async function loadEncoders() {
    try {
      state.encoders = await api.getVideoEncoders();
      const select = byId('val_burn_encoder');
      const desired = select.dataset.pendingValue || select.value;
      const groups = new Map();
      select.replaceChildren();
      for (const encoding of state.encoders) {
        if (!encoding.available) continue;
        if (!groups.has(encoding.group)) {
          const group = document.createElement('optgroup');
          group.label = encoding.group;
          groups.set(encoding.group, group);
          select.append(group);
        }
        const option = document.createElement('option');
        option.value = encoding.id;
        option.textContent = encoding.label;
        groups.get(encoding.group).append(option);
      }
      const selected = state.encoders.find((item) => item.id === desired && item.available)
        || state.encoders.find((item) => item.available);
      if (!selected) throw new Error('利用可能な動画エンコーダーがありません。');
      select.value = selected.id;
      delete select.dataset.pendingValue;
      select.dataset.encodersReady = 'true';
      state.encodersReady = true;
      updateEncoding(selected.id !== desired ? '以前のエンコーダーが利用できないため、選択を変更しました。' : '');
      saveSettings();
    } catch (error) {
      state.encodersReady = false;
      byId('burn_encoding_info').textContent = `エンコーダーの確認に失敗しました。${error.message}`;
      refreshControls();
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    refreshControls();
  }

  function clearAddInputs() {
    byId('emoji_token').value = '';
    byId('emoji_url').value = '';
    byId('emoji_token').focus({ preventScroll: true });
    byId('emoji_token').scrollIntoView({ block: 'nearest' });
  }

  function updateEmojiSource() {
    const useUrl = byId('val_emoji_source').value === 'url';
    byId('emoji_url').hidden = !useUrl;
    byId('add_emoji').hidden = useUrl;
    byId('add_emoji_url').hidden = !useUrl;
  }

  function unicodeImage(text) {
    const id = 'unicode-' + Array.from(text).map((char) => char.codePointAt(0).toString(16)).join('-');
    if (!state.unicodeImages[id]) {
      const image = document.createElement('canvas');
      image.width = image.height = 256;
      const context = image.getContext('2d');
      context.font = '218px "Noto Color Emoji", sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 128, 135, 250);
      state.unicodeImages[id] = image.toDataURL('image/png');
    }
    return id;
  }

  function layout(text, font, size, bold) {
    const runs = [];
    for (const run of tokenize(text)) {
      if (run.type === 'image') { runs.push(run); continue; }
      for (const { segment } of segmenter.segment(run.text)) {
        if (isUnicodeEmoji(segment)) {
          runs.push({ type: 'image', id: unicodeImage(segment), text: segment });
        } else if (runs.at(-1)?.type === 'text') runs.at(-1).text += segment;
        else runs.push({ type: 'text', text: segment });
      }
    }
    measure.font = `${bold ? 900 : 400} ${size}px ${JSON.stringify(font)}`;
    let offset = 0;
    for (const run of runs) {
      run.offset = offset;
      run.width = run.type === 'image' ? size * 1.15 : measure.measureText(run.text).width + 2;
      offset += run.width;
    }
    return { runs, width: offset };
  }

  function init({ hasSavedPreview = false } = {}) {
    state.previewCustomized = hasSavedPreview;
    byId('val_burn_encoder').addEventListener('change', () => updateEncoding());
    byId('val_burn_fps').addEventListener('change', () => updateEncoding());
    byId('reset_preview_text').addEventListener('click', async () => {
      try {
        await ready;
        setDefaultPreviewText();
        saveSettings();
        previewSample();
      } catch (error) { byId('emoji_status').textContent = error.message; }
    });
    byId('val_preview_text').addEventListener('input', () => {
      state.previewCustomized = true;
      if (state.previewReady) previewSample();
    });
    byId('val_emoji_source').addEventListener('change', updateEmojiSource);
    updateEmojiSource();
    byId('emoji_sample_input').addEventListener('input', sample);
    byId('val_auto_emoji').addEventListener('change', () => {
      sample();
      if (state.previewReady) previewSample();
    });
    byId('burn_video').addEventListener('click', async () => {
      if (state.busy) return;
      if (!state.video) { byId('burn_status').textContent = '先に元動画を選択してください。'; return; }
      setBusy(true);
      byId('burn_status').textContent = 'コメントを準備しています…';
      try { await generateASS('burn'); }
      catch (error) { byId('burn_status').textContent = error.message; }
      finally { setBusy(false); }
    });
    if (!api?.getEmojiSettings) {
      for (const id of ['add_emoji', 'add_emoji_url', 'val_emoji_source', 'choose_burn_video', 'burn_video']) byId(id).disabled = true;
      byId('emoji_status').textContent = '画像の登録と焼き付けはデスクトップアプリで利用できます。';
      byId('burn_encoding_info').textContent = 'エンコーダーの選択と動画出力はデスクトップアプリで利用できます。';
      ready = loadEmojiFont().then(renderLibrary);
      ready.catch((error) => { byId('emoji_status').textContent = error.message; });
      return;
    }
    ready = Promise.all([api.getEmojiSettings(), loadEmojiFont(), loadEncoders()]).then(([result]) => { Object.assign(state, result); renderLibrary(); });
    ready.catch((error) => { byId('emoji_status').textContent = error.message; });
    byId('add_emoji').addEventListener('click', async () => {
      if (byId('val_emoji_source').value !== 'file') return;
      const token = byId('emoji_token').value.trim();
      if (!token) { byId('emoji_status').textContent = '置換する文字列を入力してください。'; return; }
      const added = await changeLibrary(() => api.addEmojiImage(token));
      if (added) clearAddInputs();
    });
    byId('add_emoji_url').addEventListener('click', async () => {
      if (byId('val_emoji_source').value !== 'url') return;
      const token = byId('emoji_token').value.trim();
      const url = byId('emoji_url').value.trim();
      if (!token) { byId('emoji_status').textContent = '置換する文字列を入力してください。'; return; }
      if (!url) { byId('emoji_status').textContent = '画像・GIFのURLを入力してください。'; return; }
      const added = await changeLibrary(() => api.addEmojiUrl({ text: token, url }), 'URLから画像・GIFを取得しています…');
      if (added) clearAddInputs();
    });
    for (const id of ['emoji_token', 'emoji_url']) {
      byId(id).addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        byId(byId('val_emoji_source').value === 'url' ? 'add_emoji_url' : 'add_emoji').click();
      });
    }
    byId('choose_burn_video').addEventListener('click', async () => {
      try {
        const result = await api.chooseBurnVideo();
        if (result.canceled) return;
        state.video = true;
        byId('burn_video_name').textContent = result.name;
      } catch (error) { byId('burn_status').textContent = error.message; }
    });
    byId('cancel_burn').addEventListener('click', async () => {
      byId('cancel_burn').disabled = true;
      byId('burn_status').textContent = '中止しています…';
      try { await api.cancelVideoExport(); } catch (error) { byId('burn_status').textContent = error.message; }
    });
    api.onVideoExportProgress((progress) => {
      if (progress.percent == null) byId('burn_progress').removeAttribute('value');
      else byId('burn_progress').value = progress.percent;
      byId('burn_status').textContent = progress.percent == null ? '焼き付け中…' : `焼き付け中 ${progress.percent.toFixed(1)}%`;
    });
  }

  async function burn(plan) {
    setBusy(true);
    byId('burn_progress').value = 0;
    byId('burn_status').textContent = '保存先を選択してください…';
    try {
      const result = await api.burnVideo({ ...plan, unicodeImages: state.unicodeImages });
      byId('burn_progress').value = result.canceled ? 0 : 100;
      byId('burn_status').textContent = result.canceled ? '中止しました。' : `保存しました：${result.filePath}`;
    } catch (error) {
      byId('burn_status').textContent = error.message;
    } finally { setBusy(false); }
  }

  window.MediaUI = { init, tokenize, layout, burn, get ready() { return ready; } };
})();
