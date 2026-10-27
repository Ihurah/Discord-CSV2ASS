const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { encodingOptions, getEncoder, detectEncoders, ffmpegPath } = require('../video-encoders');
const { validatePlan, runEncoder } = require('../video-export');

const ass = '[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\pos(100,100)}Encoder test\n';
const plan = { ass, events: [], width: 1280, height: 720, fps: 30, crf: 23, preset: 'fast' };

test('encoder allowlist and container, bit-depth, quality and speed mappings', () => {
  assert.equal(getEncoder().id, 'libx264');
  assert.throws(() => getEncoder('libx264;evil'));
  assert.throws(() => validatePlan({ ...plan, encoder: '-i' }));
  for (const [encoder, qualityFlag, quality, speedFlag, speed] of [
    ['libx264', '-crf', '23', '-preset', 'fast'],
    ['libx265-10bit', '-crf', '25', '-preset', 'fast'],
    ['libaom-av1', '-crf', '33', '-cpu-used', '8'],
    ['h264_nvenc', '-cq', '23', '-preset', 'p2'],
    ['hevc_amf', '-qp_i', '25', '-quality', 'speed'],
    ['av1_amf', '-qp_i', '132', '-quality', 'speed'],
    ['hevc_qsv', '-global_quality', '25', '-preset', 'fast'],
    ['libvpx-vp9', '-crf', '33', '-cpu-used', '4'],
  ]) {
    const { videoArgs } = encodingOptions({ ...plan, encoder });
    assert.equal(videoArgs[videoArgs.indexOf(qualityFlag) + 1], quality, encoder);
    assert.equal(videoArgs[videoArgs.indexOf(speedFlag) + 1], speed, encoder);
  }
  for (const preset of ['fast', 'medium', 'slow']) {
    assert.ok(encodingOptions({ ...plan, encoder: 'h264_nvenc', preset }).videoArgs.every(value => typeof value === 'string'));
  }
  assert.equal(encodingOptions({ ...plan, encoder: 'libx265-12bit' }).pixelFormat, 'yuv420p12le');
  const webm = encodingOptions({ ...plan, encoder: 'libvpx-vp9' });
  assert.equal(webm.extension, 'webm');
  assert.ok(webm.audioArgs.includes('libopus'));
  assert.ok(!webm.muxArgs.includes('+faststart'));
  const lossless = encodingOptions({ ...plan, encoder: 'ffv1' });
  assert.equal(lossless.extension, 'mkv');
  assert.deepEqual(lossless.audioArgs, ['-c:a', 'flac']);
  assert.equal(lossless.lossless, true);
  assert.equal(lossless.supportsSpeed, false);
  assert.ok(!lossless.videoArgs.includes('-crf'));
  assert.equal(encodingOptions({ ...plan, encoder: 'mpeg2video' }).extension, 'mkv');
  const vp8 = encodingOptions({ ...plan, encoder: 'libvpx', crf: 51 }).videoArgs;
  assert.ok(Number(vp8[vp8.indexOf('-b:v') + 1]) > 0);
});

test('capability detection checks compilation, pixel formats and actual GPU initialization', async () => {
  let attempts = 0;
  const result = await detectEncoders(async (args) => {
    if (args[0] === '-encoders') return { stdout: ' V....D libx264 example\n V....D h264_nvenc example\n V....D hevc_amf example\n' };
    if (args[0] === '-h') return { stdout: 'Supported pixel formats: yuv420p nv12\n' };
    attempts++;
    if (args.includes('h264_nvenc')) throw new Error('Driver not available');
    return { stdout: '' };
  });
  assert.equal(result.find(item => item.id === 'libx264').available, true);
  assert.equal(result.find(item => item.id === 'libx264-10bit').available, false);
  assert.equal(result.find(item => item.id === 'libx265').available, false);
  assert.equal(result.find(item => item.id === 'h264_nvenc').available, false);
  assert.equal(result.find(item => item.id === 'hevc_amf').available, true);
  assert.equal(result.find(item => item.id === 'hevc_amf-10bit').available, false);
  assert.equal(attempts, 3);
});

test('rejects incompatible output extensions before starting an encoder', async () => {
  await assert.rejects(runEncoder({ plan: { ...plan, encoder: 'ffv1' }, output: 'result.mp4' }), /MKV/);
  await assert.rejects(runEncoder({ plan: { ...plan, encoder: 'libvpx-vp9' }, output: 'result.mp4' }), /WEBM/);
});

test('real outputs for every available encoder preserve codec, bit depth, audio and decodability', { timeout: 180000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-codecs-test-'));
  const ffmpeg = (args) => {
    const result = spawnSync(ffmpegPath(), ['-hide_banner', '-y', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
    return result.stderr.toString();
  };
  try {
    const input = path.join(directory, 'source.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=0.15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.15', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', input]);
    const profiles = await detectEncoders();
    assert.ok(profiles.find(item => item.id === 'libx264')?.available);
    for (const profile of profiles) {
      await t.test(profile.label, { skip: !profile.available }, async () => {
        const output = path.join(directory, `${profile.id}.${profile.extension}`);
        await runEncoder({ cwd: directory, input, output, plan: { ...plan, encoder: profile.id }, assets: [], onProgress: () => {}, registerProcess: () => {} });
        const info = ffmpeg(['-i', output, '-map', '0:v:0', '-frames:v', '1', '-an', '-f', 'null', '-']);
        const codec = profile.codec.includes('264') ? 'h264' : profile.codec.includes('265') || profile.codec.startsWith('hevc') ? 'hevc'
          : profile.codec.includes('av1') ? 'av1' : profile.codec === 'libvpx' ? 'vp8' : profile.codec.startsWith('libvpx-vp9') ? 'vp9' : profile.codec;
        assert.match(info, new RegExp(`Video: ${codec}\\b`));
        const audio = profile.lossless ? 'flac' : profile.extension === 'webm' ? 'opus' : 'aac';
        assert.match(info, new RegExp(`Audio: ${audio}\\b`));
        if (profile.pixelFormat.includes('10')) assert.match(info, /yuv420p10le/);
        if (profile.pixelFormat.includes('12')) assert.match(info, /yuv420p12le/);
        ffmpeg(['-i', output, '-map', '0:a:0', '-t', '0.05', '-f', 'null', '-']);
        if (profile.supportsSourceRate) {
          const nativeOutput = path.join(directory, `${profile.id}-source.${profile.extension}`);
          await runEncoder({ cwd: directory, input, output: nativeOutput, plan: { ...plan, encoder: profile.id, fps: 'source' }, assets: [], onProgress: () => {}, registerProcess: () => {} });
          const nativeInfo = ffmpeg(['-i', nativeOutput, '-map', '0:v:0', '-frames:v', '1', '-an', '-f', 'null', '-']);
          assert.match(nativeInfo, new RegExp(`Video: ${codec}\\b`));
          assert.match(nativeInfo, /30 fps/);
        }
      });
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
