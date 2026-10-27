const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getFrameRate } = require('./video-frame-rates');

const executeFile = promisify(execFile);

function ffmpegPath() {
  const executable = require('ffmpeg-static');
  if (!executable) throw new Error('このOS用のFFmpegが見つかりません。');
  return executable.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

const profiles = [];
function add(id, label, codec, family, extension = 'mp4', pixelFormat = 'yuv420p', group = 'CPU') {
  profiles.push({ id, label, codec, family, extension, pixelFormat, group,
    lossless: family === 'ffv1', supportsSpeed: !['ffv1', 'mpeg'].includes(family), supportsSourceRate: family !== 'mpeg' });
}
add('libx264', 'H.264 (x264)', 'libx264', 'x264');
add('libx264-10bit', 'H.264 10-bit (x264)', 'libx264', 'x264', 'mp4', 'yuv420p10le');
for (const bits of [8, 10, 12]) {
  add(bits === 8 ? 'libx265' : `libx265-${bits}bit`, `H.265${bits === 8 ? '' : ` ${bits}-bit`} (x265)`, 'libx265', 'x265', 'mp4', bits === 8 ? 'yuv420p' : `yuv420p${bits}le`);
}
for (const bits of [8, 10]) {
  add(bits === 8 ? 'libaom-av1' : 'libaom-av1-10bit', `AV1${bits === 8 ? '' : ' 10-bit'} (AOM)`, 'libaom-av1', 'aom', 'mp4', bits === 8 ? 'yuv420p' : 'yuv420p10le');
}
for (const [backend, group] of [['nvenc', 'NVIDIA NVENC'], ['amf', 'AMD AMF'], ['qsv', 'Intel QSV']]) {
  for (const [codec, name] of [['h264', 'H.264'], ['hevc', 'H.265'], ['av1', 'AV1']]) {
    for (const bits of codec === 'h264' ? [8] : [8, 10]) {
      const encoder = `${codec}_${backend}`;
      add(bits === 8 ? encoder : `${encoder}-10bit`, `${name}${bits === 8 ? '' : ' 10-bit'} (${group})`, encoder, backend,
        'mp4', bits === 10 ? 'p010le' : backend === 'qsv' ? 'nv12' : 'yuv420p', group);
    }
  }
}
add('libvpx', 'VP8', 'libvpx', 'vp8', 'webm');
add('libvpx-vp9', 'VP9', 'libvpx-vp9', 'vp9', 'webm');
add('libvpx-vp9-10bit', 'VP9 10-bit', 'libvpx-vp9', 'vp9', 'webm', 'yuv420p10le');
add('ffv1', 'FFV1 (ロスレス)', 'ffv1', 'ffv1', 'mkv');
add('mpeg2video', 'MPEG-2', 'mpeg2video', 'mpeg', 'mkv');
add('mpeg4', 'MPEG-4', 'mpeg4', 'mpeg');

function getEncoder(id = 'libx264') {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error('動画エンコーダーの設定が不正です。');
  return profile;
}

function encodingOptions(plan) {
  const profile = getEncoder(plan.encoder);
  const quality = plan.crf ?? 18;
  const speed = plan.preset ?? 'medium';
  const fps = getFrameRate(plan.fps)?.fps ?? 60;
  const args = ['-c:v', profile.codec];
  const offset = profile.codec.startsWith('av1') || ['aom', 'vp8', 'vp9'].includes(profile.family) ? 10
    : profile.codec.startsWith('hevc') || profile.family === 'x265' ? 2 : 0;
  const q = Math.max(1, Math.min(51, quality + offset));
  switch (profile.family) {
    case 'x264':
    case 'x265':
      args.push('-preset', speed, '-crf', String(q));
      break;
    case 'aom':
      args.push('-crf', String(q), '-b:v', '0', '-cpu-used', String({ fast: 8, medium: 6, slow: 4 }[speed]), '-row-mt', '1');
      break;
    case 'nvenc':
      args.push('-preset', { fast: 'p2', medium: 'p4', slow: 'p6' }[speed], '-rc', 'vbr', '-cq', String(q), '-b:v', '0');
      break;
    case 'amf': {
      const qp = profile.codec === 'av1_amf' ? Math.min(255, q * 4) : q;
      args.push('-quality', { fast: 'speed', medium: 'balanced', slow: 'quality' }[speed], '-rc', 'cqp', '-qp_i', String(qp), '-qp_p', String(qp));
      break;
    }
    case 'qsv':
      args.push('-preset', speed, '-global_quality', String(q));
      break;
    case 'vp8':
    case 'vp9':
      args.push('-crf', String(q), '-b:v', profile.family === 'vp9' ? '0' : String(Math.round(plan.width * plan.height * fps * Math.max(0.03, 0.18 - (quality - 18) * 0.008))),
        '-deadline', 'good', '-cpu-used', String({ fast: 4, medium: 2, slow: 0 }[speed]));
      if (profile.family === 'vp9') args.push('-row-mt', '1');
      break;
    case 'ffv1':
      args.push('-level', '3', '-g', '1', '-slicecrc', '1');
      break;
    case 'mpeg':
      args.push('-q:v', String(Math.max(2, Math.min(31, Math.round(2 + (quality - 18) * 0.6)))));
      break;
  }
  args.push('-pix_fmt', profile.pixelFormat);
  if (profile.codec.startsWith('hevc') || profile.family === 'x265') args.push('-tag:v', 'hvc1');
  const audioArgs = profile.extension === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k']
    : profile.lossless ? ['-c:a', 'flac'] : ['-c:a', 'aac', '-b:a', '192k'];
  const muxer = { mp4: 'mp4', webm: 'webm', mkv: 'matroska' }[profile.extension];
  const muxArgs = profile.extension === 'mp4' ? ['-movflags', '+faststart', '-f', muxer] : ['-f', muxer];
  return { ...profile, videoArgs: args, audioArgs, muxArgs };
}

async function execute(args) {
  return executeFile(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
    { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
}

async function detectEncoders(run = execute) {
  const { stdout } = await run(['-encoders']);
  const compiled = new Set(stdout.split(/\r?\n/).filter((line) => /^\s*V\S{5}\s/.test(line)).map((line) => line.trim().split(/\s+/)[1]));
  const result = new Array(profiles.length);
  const formats = new Map();
  let next = 0;
  // Probe one frame, not just the compiled list: GPU drivers may be missing.
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < profiles.length) {
      const index = next++;
      const profile = profiles[index];
      let available = false;
      let reason = '同梱FFmpegが対応していません';
      if (compiled.has(profile.codec)) {
        try {
          if (!formats.has(profile.codec)) formats.set(profile.codec, run(['-h', `encoder=${profile.codec}`]).then(({ stdout: help }) =>
            help.match(/Supported pixel formats:\s*([^\r\n]+)/)?.[1].split(/\s+/) || []));
          if (!(await formats.get(profile.codec)).includes(profile.pixelFormat)) {
            result[index] = { ...profile, available: false, reason: 'このFFmpegでは指定のビット深度に対応していません' };
            continue;
          }
          const config = encodingOptions({ encoder: profile.id, crf: 23, preset: 'fast', width: 1280, height: 720, fps: 30 });
          const probeArgs = [...config.videoArgs, '-threads', '2'];
          if (profile.family === 'x265') probeArgs.push('-x265-params', 'pools=2:frame-threads=2');
          await run(['-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30:d=0.04', '-frames:v', '1', '-an', ...probeArgs, '-f', 'null', '-']);
          available = true;
          reason = '';
        } catch {
          reason = profile.group === 'CPU' ? 'この環境では初期化できません' : '対応GPU・ドライバーを確認できません';
        }
      }
      result[index] = { ...profile, available, reason };
    }
  }));
  return result;
}

module.exports = { ffmpegPath, getEncoder, encodingOptions, detectEncoders };
