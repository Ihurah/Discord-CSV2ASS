const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ffmpegPath, getEncoder, encodingOptions } = require('./video-encoders');
const { getFrameRate } = require('./video-frame-rates');

function buildGraph({ width, height, fps, events, assets, encoder }) {
  const rate = getFrameRate(fps);
  const timing = rate ? `fps=${rate.filter},` : '';
  const filters = [`[0:v:0]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,${timing}ass=comments.ass[base]`];
  let previous = 'base';
  assets.forEach((asset, assetIndex) => {
    const occurrences = events.filter((event) => event.assetId === asset.id);
    if (!occurrences.length) return;
    const sources = occurrences.map((_, i) => `source${assetIndex}_${i}`);
    filters.push(`[${assetIndex + 1}:v]${timing}format=rgba,split=${sources.length}${sources.map((name) => `[${name}]`).join('')}`);
    occurrences.forEach((event, index) => {
      const label = `emoji${assetIndex}_${index}`;
      const next = `composite${assetIndex}_${index}`;
      const start = event.startMs / 1000;
      const duration = event.durationMs / 1000;
      const end = start + duration;
      // Clip before delaying timestamps so each GIF starts with the comment.
      filters.push(`[${sources[index]}]trim=start=${event.elapsedMs / 1000}:duration=${duration},setpts=PTS-STARTPTS+${start}/TB,scale=${event.size}:${event.size}:force_original_aspect_ratio=decrease,pad=${event.size}:${event.size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,colorchannelmixer=aa=${event.opacity}[${label}]`);
      filters.push(`[${previous}][${label}]overlay=x='${event.x}-(${event.speed})*(t-${start})':y=${event.y}:eval=frame:eof_action=pass:repeatlast=0:enable='gte(t,${start})*lt(t,${end})'[${next}]`);
      previous = next;
    });
  });
  filters.push(`[${previous}]format=${getEncoder(encoder).pixelFormat}[out]`);
  return filters.join(';\n');
}

function validatePlan(plan) {
  const encoder = getEncoder(plan.encoder);
  if (typeof plan.ass !== 'string' || !plan.ass.startsWith('[Script Info]')) throw new Error('字幕データが不正です。');
  if (!['1280x720', '1920x1080', '2560x1440', '3840x2160'].includes(`${plan.width}x${plan.height}`)) throw new Error('出力解像度が不正です。');
  const rate = getFrameRate(plan.fps);
  if (!rate && !encoder.supportsSourceRate) throw new Error('MPEG-2/4では「ソースと同じ」は使えません。固定フレームレートを選択してください。');
  if (!Number.isInteger(plan.crf ?? 18) || (plan.crf ?? 18) < 0 || (plan.crf ?? 18) > 51) throw new Error('画質（CRF）は0〜51の整数で指定してください。');
  if (!['fast', 'medium', 'slow'].includes(plan.preset ?? 'medium')) throw new Error('エンコード速度の設定が不正です。');
  if (!Array.isArray(plan.events)) throw new Error('画像データが不正です。');
  for (const event of plan.events) {
    for (const key of ['startMs', 'durationMs', 'elapsedMs', 'x', 'y', 'speed', 'size', 'opacity']) {
      if (!Number.isFinite(event[key])) throw new Error('画像の位置・時刻が不正です。');
    }
    if (event.startMs < 0 || event.durationMs <= 0 || event.elapsedMs < 0 || event.speed <= 0 || event.size < 1 || event.size > 2048 || !Number.isInteger(event.size) || event.opacity < 0 || event.opacity > 1) throw new Error('画像の表示設定が不正です。');
  }
}

async function runEncoder({ cwd, input, output, plan, assets, onProgress, registerProcess }) {
  validatePlan(plan);
  const encoding = encodingOptions(plan);
  const rate = getFrameRate(plan.fps);
  if (path.extname(output).toLowerCase() !== `.${encoding.extension}`) throw new Error(`このエンコーダーの保存形式は${encoding.extension.toUpperCase()}です。`);
  const graph = buildGraph({ ...plan, assets });
  await fs.writeFile(path.join(cwd, 'comments.ass'), plan.ass, 'utf8');
  await fs.writeFile(path.join(cwd, 'filters.txt'), graph, 'utf8');
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input];
  assets.forEach((asset) => {
    if (path.extname(asset.path).toLowerCase() === '.gif') args.push('-ignore_loop', '0');
    else args.push('-loop', '1', '-framerate', rate?.filter || '30');
    args.push('-i', asset.path);
  });
  args.push('-filter_complex_threads', '1', '-filter_complex_script', 'filters.txt',
    '-map', '[out]', '-map', '0:a:0?', ...encoding.videoArgs,
    ...(rate ? ['-fps_mode', 'cfr', '-r', rate.filter] : ['-fps_mode', 'passthrough', '-enc_time_base', 'filter']),
    ...encoding.audioArgs, ...encoding.muxArgs,
    '-progress', 'pipe:1', '-nostats', output);
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    registerProcess(child);
    let stderr = '', progress = '', duration = 0;
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-16000);
      const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (match) duration = (+match[1] * 3600 + +match[2] * 60 + +match[3]) * 1000;
    });
    child.stdout.on('data', (chunk) => {
      progress += chunk;
      const lines = progress.split(/\r?\n/);
      progress = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('out_time_us=')) continue;
        const ms = Number(line.slice(12)) / 1000;
        if (Number.isFinite(ms)) onProgress({ milliseconds: ms, percent: duration ? Math.min(99, ms / duration * 100) : null });
      }
    });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited with code ${code}`)));
  });
}

module.exports = { ffmpegPath, buildGraph, validatePlan, runEncoder };
