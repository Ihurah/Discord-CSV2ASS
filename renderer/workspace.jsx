import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  Badge, Button, Card, CardHeader, FluentProvider, ProgressBar,
  Tab, TabList, Text, Tooltip, webLightTheme,
} from '@fluentui/react-components';
import {
  ArrowDownload20Regular, ArrowExpand20Regular, Emoji24Regular, Eye24Regular,
  FolderOpen20Regular, Settings24Regular, Video24Regular,
} from '@fluentui/react-icons';
import './workspace.css';

const byId = (id) => document.getElementById(id);

function collectControls() {
  const settings = document.querySelector('.settings-area');
  const headings = [...settings.querySelectorAll(':scope > h3')];
  const between = (start, end) => {
    const result = [];
    for (let node = start.nextElementSibling; node && node !== end; node = node.nextElementSibling) result.push(node);
    return result;
  };
  const outline = byId('section_outline');
  const shadow = byId('section_shadow');
  const emoji = byId('emoji_heading').parentElement;
  const preview = document.querySelector('.preview-area');
  const background = preview.querySelector('.row');
  const burn = byId('burn_heading').parentElement;
  const outputButton = [...preview.querySelectorAll('button')].find((button) => button.getAttribute('onclick') === 'generateASS()');
  outputButton.id = 'save_ass_button';
  const slots = {
    data: between(headings[0], headings[1]).filter((node) => !node.classList.contains('subtext')),
    basic: between(headings[1], headings[2]),
    text: between(headings[2], outline.previousElementSibling),
    outline: [outline.previousElementSibling, outline],
    shadow: [shadow.previousElementSibling, shadow],
    background: [background],
    sample: [preview.querySelector('.preview-sample-editor')],
    preview: [byId('preview_box')],
    modal: [byId('preview_modal')],
  };
  for (const node of [...slots.basic, ...slots.text, ...slots.outline, ...slots.shadow]) {
    const label = node.querySelector('label');
    const input = node.querySelector('input:not([type="range"]), select');
    if (label && input?.id) label.htmlFor = input.id;
  }
  const toggleLabels = [['check_outline', '縁取りを使う'], ['check_shadow', '影を使う']];
  toggleLabels.forEach(([id, label]) => { document.querySelector(`label[for="${id}"]`).textContent = label; });

  const parking = document.createElement('div');
  parking.id = 'ui-native-actions';
  parking.hidden = true;
  document.body.append(parking);
  const park = (id) => parking.append(byId(id));
  ['save_ass_button', 'open_preview_modal', 'choose_burn_video', 'burn_video', 'cancel_burn', 'add_emoji', 'add_emoji_url'].forEach(park);

  const addFields = emoji.querySelector('.emoji-add-fields');
  const registration = document.createElement('div');
  registration.className = 'emoji-registration';
  const label = document.createElement('label');
  label.htmlFor = 'emoji_token';
  label.textContent = 'コメントに記録されている文字列';
  registration.append(label, addFields);
  emoji.querySelector('tfoot').remove();
  const conversion = document.createElement('div');
  conversion.className = 'emoji-conversion';
  conversion.append(byId('val_auto_emoji').closest('.row'), byId('emoji_sample_input').parentElement, byId('emoji_sample'));
  slots.emojiForm = [registration, byId('emoji_status')];
  slots.emojiList = [byId('emoji_count'), emoji.querySelector('.emoji-list')];
  slots.emojiTest = [conversion];
  slots.video = [byId('burn_video_name')];
  slots.encoding = [...burn.querySelectorAll(':scope > .row')];
  slots.encodingInfo = [byId('burn_encoding_info')];
  slots.progress = [byId('burn_status')];
  parking.append(byId('burn_progress'));

  return slots;
}

// Keep the existing form nodes alive so native file selections, IPC handlers,
// persisted values and conversion settings survive React tab switches.
function NativeControls({ nodes, className = '' }) {
  const host = useRef(null);
  useLayoutEffect(() => { host.current.append(...nodes); }, [nodes]);
  return <div ref={host} className={`native-controls ${className}`} />;
}

function useNativeButton(id) {
  const read = () => ({ disabled: byId(id).disabled, hidden: byId(id).hidden, label: byId(id).textContent.trim() });
  const [button, setButton] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setButton(read()));
    observer.observe(byId(id), { attributes: true, attributeFilter: ['disabled', 'hidden'], childList: true, subtree: true, characterData: true });
    setButton(read());
    return () => observer.disconnect();
  }, [id]);
  return button;
}

function ActionButton({ target, children, iconOnly = false, ...props }) {
  const button = useNativeButton(target);
  return <Button {...props} data-action={target} disabled={button.disabled} hidden={button.hidden} onClick={() => byId(target).click()}>{iconOnly ? null : children || button.label}</Button>;
}

function useProjectValues() {
  const read = () => ({
    file: byId('csv_file').files[0]?.name || '',
    time: byId('val_time').value,
    font: byId('val_font').selectedOptions[0]?.textContent || byId('val_font').value,
    size: byId('val_size').value,
    duration: byId('val_duration').value,
    area: byId('val_comment_area').value,
    resolution: byId('val_resolution').value,
  });
  const [values, setValues] = useState(read);
  useEffect(() => {
    const refresh = () => setValues((previous) => {
      const next = read();
      return Object.keys(next).every((key) => previous[key] === next[key]) ? previous : next;
    });
    document.addEventListener('input', refresh);
    document.addEventListener('change', refresh);
    window.addEventListener('comment-preview-updated', refresh);
    return () => {
      document.removeEventListener('input', refresh);
      document.removeEventListener('change', refresh);
      window.removeEventListener('comment-preview-updated', refresh);
    };
  }, []);
  return values;
}

function ExportProgress() {
  const read = () => byId('burn_progress').hasAttribute('value') ? byId('burn_progress').value / 100 : undefined;
  const [value, setValue] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setValue(read()));
    observer.observe(byId('burn_progress'), { attributes: true });
    return () => observer.disconnect();
  }, []);
  return <ProgressBar value={value} thickness="large" aria-label="動画書き出しの進捗" />;
}

function PanelCard({ title, description, action, children, className = '' }) {
  return <Card className={`workspace-card ${className}`}>
    <CardHeader header={<Text weight="semibold" size={400}>{title}</Text>} description={description ? <Text size={200} className="muted">{description}</Text> : undefined} action={action} />
    {children}
  </Card>;
}

const tabs = [
  { id: 'settings', label: 'コメント設定', icon: <Settings24Regular />, title: 'コメントの見た目を整える', description: '読み込んだコメントの文字や動き、縁取り・影を設定します。' },
  { id: 'preview', label: 'プレビュー', icon: <Eye24Regular />, title: '仕上がりを大きく確認', description: '背景とサンプルテキストを変えて、実際の見え方を確認できます。' },
  { id: 'emoji', label: '絵文字', icon: <Emoji24Regular />, title: 'Discord絵文字を管理', description: 'コメント内の文字列に画像やGIFを割り当てます。' },
  { id: 'burn', label: '焼き付け', icon: <Video24Regular />, title: 'コメント付きの動画を書き出す', description: '元動画に文字・画像・動くGIFを合成し、選択した形式で保存します。' },
];

function storedChoice(key, choices, fallback) {
  try { const value = localStorage.getItem(key); return choices.includes(value) ? value : fallback; }
  catch { return fallback; }
}

function Workspace({ slots }) {
  const [active, setActive] = useState(() => storedChoice('discord-csv2ass-ui-tab', tabs.map((tab) => tab.id), 'settings'));
  const [detail, setDetail] = useState('basic');
  const values = useProjectValues();
  const theme = { ...webLightTheme, fontFamilyBase: '"Segoe UI Variable", "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif' };
  useEffect(() => {
    document.documentElement.dataset.uiTheme = 'light';
  }, []);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => window.updatePreview());
    return () => cancelAnimationFrame(frame);
  }, [active, detail]);
  useLayoutEffect(() => { document.querySelector('.workspace-scroll').scrollTop = 0; }, [active]);
  const selectTab = (_, data) => {
    setActive(data.value);
    try { localStorage.setItem('discord-csv2ass-ui-tab', data.value); } catch {}
  };
  const current = tabs.find((tab) => tab.id === active);
  const changeResolution = (event) => {
    byId('val_resolution').value = event.target.value;
    byId('val_resolution').dispatchEvent(new Event('change', { bubbles: true }));
  };
  return <FluentProvider theme={theme} className="fluent-frame">
    <nav className="workspace-nav" aria-label="作業の切り替え"><TabList selectedValue={active} onTabSelect={selectTab} size="large">
      {tabs.map((tab) => <Tab key={tab.id} id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} value={tab.id} icon={tab.icon}>{tab.label}</Tab>)}
    </TabList></nav>
    <main className="workspace-scroll">
      <div className="workspace-content">
        <div className="page-heading"><div><h1>{current.title}</h1><p>{current.description}</p></div><Badge appearance="outline" color={values.file ? 'success' : 'subtle'}>{values.file ? 'コメント読み込み済み' : 'CSV / XML 対応'}</Badge></div>
        <div className={`workspace-layout layout-${active}`}>
          <div className="workspace-pages">
            <section id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" hidden={active !== 'settings'} className="page-stack">
              <PanelCard title="コメントファイル" description="DiscordChatExporterのCSV、またはニコニコ形式のXML"><NativeControls nodes={slots.data} /></PanelCard>
              <Card className="workspace-card">
                <TabList selectedValue={detail} onTabSelect={(_, data) => setDetail(data.value)}>
                  <Tab id="tab-basic" value="basic" aria-controls="settings-basic">基本設定</Tab><Tab id="tab-appearance" value="appearance" aria-controls="settings-appearance">文字・縁取り・影</Tab>
                </TabList>
                <div id="settings-basic" role="tabpanel" aria-labelledby="tab-basic" hidden={detail !== 'basic'}><p className="card-description">フォントと表示範囲、コメントが流れる時間を調整します。</p><NativeControls nodes={slots.basic} /></div>
                <div id="settings-appearance" role="tabpanel" aria-labelledby="tab-appearance" hidden={detail !== 'appearance'} className="appearance-stack">
                  <div><h3>文字色と透明度</h3><NativeControls nodes={slots.text} /></div>
                  <div className="appearance-section"><NativeControls nodes={slots.outline} /></div>
                  <div className="appearance-section"><NativeControls nodes={slots.shadow} /></div>
                </div>
              </Card>
              <PanelCard title="ASS字幕として保存" description="外部の字幕対応ソフトで使う場合はこちら。独自画像・GIFの焼き付けは「焼き付け」タブから行えます。"><ActionButton target="save_ass_button" appearance="primary" icon={<ArrowDownload20Regular />}>ASSファイルを生成して保存</ActionButton></PanelCard>
            </section>
            <section id="panel-preview" role="tabpanel" aria-labelledby="tab-preview" hidden={active !== 'preview'} className="page-stack">
              <PanelCard title="背景を変える" description="背景の色や画像はプレビューにだけ反映されます。"><NativeControls nodes={slots.background} className="background-controls" /></PanelCard>
              <PanelCard title="サンプルテキスト" description="改行や絵文字を含めて自由に編集できます。"><NativeControls nodes={slots.sample} /></PanelCard>
            </section>
            <section id="panel-emoji" role="tabpanel" aria-labelledby="tab-emoji" hidden={active !== 'emoji'} className="emoji-layout">
              <PanelCard title="登録した絵文字"><NativeControls nodes={slots.emojiList} /></PanelCard>
              <div className="page-stack">
                <PanelCard title="絵文字を追加" description="同じ文字列で追加すると、登録済みの画像を更新します。"><NativeControls nodes={slots.emojiForm} /><div className="action-row"><ActionButton target="add_emoji" appearance="primary" icon={<FolderOpen20Regular />}>追加</ActionButton><ActionButton target="add_emoji_url" appearance="primary" icon={<ArrowDownload20Regular />}>追加</ActionButton></div><p className="field-help">PNG / JPEG / WebP / GIF・20MBまで。URLは画像への直接リンクを指定してください。</p></PanelCard>
                <PanelCard title="変換を試す" description="確認用の文字列です。動画のコメントには追加されません。"><NativeControls nodes={slots.emojiTest} /></PanelCard>
              </div>
            </section>
            <section id="panel-burn" role="tabpanel" aria-labelledby="tab-burn" hidden={active !== 'burn'} className="page-stack">
              <PanelCard title="1. 元動画を選択" description="元動画は上書きせず、コメント付きの動画を新しく保存します。"><ActionButton target="choose_burn_video" icon={<FolderOpen20Regular />}>元動画を選択</ActionButton><NativeControls nodes={slots.video} /></PanelCard>
              <PanelCard title="2. 出力設定" description="エンコーダーに合わせて保存形式を切り替えます。解像度が合わない部分には余白を追加します。"><div className="native-controls"><div className="row"><label htmlFor="burn-resolution">出力解像度</label><select id="burn-resolution" value={values.resolution} onChange={changeResolution}><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option><option value="3840x2160">3840 × 2160</option></select></div><NativeControls nodes={slots.encoding} /></div><NativeControls nodes={slots.encodingInfo} /></PanelCard>
              <PanelCard title="3. 焼き付けて保存" description="文字・絵文字・動くGIFを、現在の設定で動画へ合成します。"><div className="action-row"><ActionButton target="burn_video" appearance="primary" icon={<Video24Regular />} /><ActionButton target="cancel_burn">中止</ActionButton></div><ExportProgress /><NativeControls nodes={slots.progress} /></PanelCard>
            </section>
          </div>
          <aside className="preview-side" hidden={active === 'emoji' || active === 'burn'}>
            <PanelCard title="プレビュー" description={`${values.resolution.replace('x', ' × ')} / 現在の見た目`} action={<Tooltip content="プレビューを拡大" relationship="label"><ActionButton target="open_preview_modal" appearance="subtle" icon={<ArrowExpand20Regular />} iconOnly aria-label="プレビューを拡大" /></Tooltip>} className="live-preview-card"><NativeControls nodes={slots.preview} /><div className="preview-caption"><span className="live-dot" />設定変更をリアルタイムに反映</div>{active !== 'preview' && <Button appearance="subtle" onClick={() => selectTab(null, { value: 'preview' })}>背景・サンプルテキストを編集</Button>}</PanelCard>
            <PanelCard title="現在の設定" className="summary-card"><dl><div><dt>コメント</dt><dd title={values.file}>{values.file || '未選択'}</dd></div><div><dt>開始時刻</dt><dd>{values.time}</dd></div><div><dt>フォント</dt><dd>{values.font}</dd></div><div><dt>文字サイズ</dt><dd>{values.size} px</dd></div><div><dt>表示時間</dt><dd>{values.duration} 秒</dd></div><div><dt>表示範囲</dt><dd>上から {values.area}%</dd></div></dl></PanelCard>
          </aside>
        </div>
      </div>
    </main>
    <NativeControls nodes={slots.modal} className="modal-host" />
  </FluentProvider>;
}

const rootElement = byId('fluent-root');
const slots = collectControls();
flushSync(() => createRoot(rootElement).render(<Workspace slots={slots} />));
document.body.classList.add('fluent-ready');
byId('legacy-app').hidden = true;
rootElement.dataset.ready = 'true';
window.updatePreview();
