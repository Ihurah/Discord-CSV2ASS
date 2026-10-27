const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createTokenizer } = require('../emoji-text');
const { buildGraph, validatePlan, ffmpegPath, runEncoder } = require('../video-export');
const { MediaLibrary } = require('../media-library');
const { choices, getFrameRate } = require('../video-frame-rates');

test('shortcodes, custom precedence, unknown tokens and literal punctuation', async () => {
  const { nameToEmoji } = await import('gemoji');
  const tokenize = createTokenizer(nameToEmoji, [
    { id: 'custom', text: ':pear:' }, { id: 'long', text: ':pear:more' },
    { id: 'literal', text: '[x].*' },
  ]);
  assert.deepEqual(tokenize(':pear:more:pear: :smile: :not_real: [x].*'), [
    { type: 'image', text: ':pear:more', id: 'long' },
    { type: 'image', text: ':pear:', id: 'custom' },
    { type: 'text', text: ` ${nameToEmoji.smile} :not_real: ` },
    { type: 'image', text: '[x].*', id: 'literal' },
  ]);
  assert.equal(createTokenizer(nameToEmoji)(':pear:')[0].text, '\u{1f350}');
  assert.equal(createTokenizer({})(':pear:')[0].text, ':pear:');
});

const ass = '[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\pos(300,100)}Test\n';
const plan = () => ({ ass, width: 1280, height: 720, fps: 30, events: [] });

test('rejects malformed numeric overlay parameters', () => {
  assert.throws(() => validatePlan({ ...plan(), fps: 0 }));
  assert.throws(() => validatePlan({ ...plan(), crf: 52 }));
  assert.throws(() => validatePlan({ ...plan(), crf: 18.5 }));
  assert.throws(() => validatePlan({ ...plan(), preset: 'untrusted' }));
  assert.throws(() => validatePlan({ ...plan(), events: [{ x: '1;movie=evil' }] }));
  assert.match(buildGraph({ ...plan(), assets: [] }), /ass=comments\.ass/);
});

test('frame-rate choices accept only supported rates and retain exact NTSC fractions', () => {
  for (const fps of [...choices, ...choices.map(Number), 'source']) {
    assert.doesNotThrow(() => validatePlan({ ...plan(), fps }));
  }
  for (const fps of [0, -1, 121, 29.5, NaN, Infinity, '', '30;movie=bad', '1/0', null, {}]) {
    assert.throws(() => validatePlan({ ...plan(), fps }));
  }
  assert.equal(getFrameRate(23.976).filter, '24000/1001');
  assert.equal(getFrameRate('29.97').filter, '30000/1001');
  assert.equal(getFrameRate('59.94').filter, '60000/1001');
  assert.equal(getFrameRate('60000/1001').value, '59.94');
  assert.equal(getFrameRate('source'), null);
  assert.match(buildGraph({ ...plan(), fps: '23.976', assets: [] }), /fps=24000\/1001,/);
  assert.doesNotMatch(buildGraph({ ...plan(), fps: 'source', assets: [] }), /fps=/);
  assert.throws(() => validatePlan({ ...plan(), encoder: 'mpeg2video', fps: 'source' }), /固定フレームレート/);
});

function inspectTiming(filename) {
  const result = spawnSync(ffmpegPath(), ['-hide_banner', '-i', filename, '-map', '0:v:0', '-vf', 'showinfo', '-fps_mode', 'passthrough', '-an', '-f', 'null', '-'],
    { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  const log = result.stderr.toString();
  return {
    rate: log.match(/config in time_base: [^,]+, frame_rate: (\d+\/\d+)/)?.[1],
    times: [...log.matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([\d.e+-]+)/g)].map(match => Number(match[1])),
  };
}

test('all fixed frame rates encode exact rates without changing playback speed', { timeout: 90000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-fps-test-'));
  try {
    const input = path.join(directory, 'source.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=1280x720:r=120:d=0.6', '-c:v', 'libx264', '-preset', 'ultrafast', input]);
    for (const fps of choices) {
      await t.test(`${fps} fps`, async () => {
        const output = path.join(directory, `${fps}.mp4`);
        await runEncoder({ cwd: directory, input, output, plan: { ...plan(), fps, preset: 'fast' }, assets: [], onProgress: () => {}, registerProcess: () => {} });
        const timing = inspectTiming(output);
        const expected = getFrameRate(fps);
        assert.equal(timing.rate, expected.filter.includes('/') ? expected.filter : `${fps}/1`);
        assert.ok(Math.abs(timing.times.length / expected.fps - 0.6) <= 1 / expected.fps + 0.001);
        for (let i = 1; i < timing.times.length; i++) assert.ok(Math.abs(timing.times[i] - timing.times[i - 1] - 1 / expected.fps) < 0.00001);
      });
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('same as source preserves VFR timestamps with static and animated overlays', { timeout: 90000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-source-fps-test-'));
  try {
    const input = path.join(directory, 'vfr.mp4');
    const gif = path.join(directory, 'animated.gif');
    const png = path.join(directory, 'static.png');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=120:d=1', '-vf', 'select=eq(mod(n\\,10)\\,0)+eq(mod(n\\,10)\\,1)', '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', input]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=32x32:r=4:d=1', '-loop', '0', gif]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=blue:s=32x32', '-frames:v', '1', png]);
    const event = { startMs: 100, durationMs: 600, elapsedMs: 0, x: 100, y: 100, speed: 20, size: 40, opacity: 0.5 };
    const output = path.join(directory, 'source-timing.mp4');
    await runEncoder({ cwd: directory, input, output, assets: [{ id: 'gif', path: gif }, { id: 'png', path: png }],
      plan: { ...plan(), fps: 'source', preset: 'fast', events: [{ ...event, assetId: 'gif' }, { ...event, assetId: 'png', y: 200 }] },
      onProgress: () => {}, registerProcess: () => {},
    });
    const before = inspectTiming(input).times;
    const after = inspectTiming(output).times;
    assert.ok(before.length > 10);
    assert.ok(new Set(before.slice(1).map((time, index) => Math.round((time - before[index]) * 1000))).size > 1, 'Fixture must contain variable frame durations');
    assert.equal(after.length, before.length);
    before.forEach((time, index) => assert.ok(Math.abs(time - after[index]) < 0.00002, `frame ${index}: ${time} vs ${after[index]}`));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('library copies assets and persists replacements independently of the source file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-library-test-'));
  try {
    const original = path.join(directory, 'original.gif');
    await fs.writeFile(original, Buffer.from('GIF89a'));
    const library = new MediaLibrary(path.join(directory, 'library'), {
      createFromBuffer: () => ({ isEmpty: () => false }),
    });
    await library.load();
    await library.importMappings([{ text: ':custom:', file: original }]);
    const oldFile = library.assetPath(library.entries[0]);
    await library.importMappings([{ text: ':custom:', file: original }]);
    assert.equal(library.entries.length, 1);
    await assert.rejects(fs.stat(oldFile), { code: 'ENOENT' });
    await fs.rm(original);
    const reloaded = new MediaLibrary(library.directory, library.nativeImage);
    await reloaded.load();
    assert.equal((await reloaded.list())[0].text, ':custom:');
    await reloaded.remove(reloaded.entries[0].id);
    assert.deepEqual(await reloaded.list(), []);
    assert.throws(() => library.assetPath({ file: '../escape.png' }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

function ffmpeg(args) {
  const result = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return result.stdout;
}

test('developer presets refresh independently, while custom overrides can fall back', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-presets-test-'));
  try {
    const bundled = path.join(directory, 'youtube');
    await fs.mkdir(path.join(bundled, 'images'), { recursive: true });
    const image = path.join(bundled, 'images', 'stamp.gif');
    const config = path.join(bundled, 'emoji-map.json');
    await fs.writeFile(image, Buffer.from('GIF89a-first'));
    await fs.writeFile(config, '\uFEFF' + JSON.stringify({ emojis: [{ text: ':yt:', file: 'images/stamp.gif' }] }));
    const nativeImage = { createFromBuffer: () => ({ isEmpty: () => false }) };
    const create = async () => {
      const library = new MediaLibrary(path.join(directory, 'user-library'), nativeImage);
      await library.load();
      await library.loadBundledConfig(config, 'youtube');
      return library;
    };
    let library = await create();
    const first = (await library.list())[0];
    assert.equal(first.source, 'youtube');
    assert.equal(first.bundled, true);
    assert.equal(library.entries.length, 0, 'Preset must not become a persisted user entry');
    await fs.writeFile(image, Buffer.from('GIF89a-updated'));
    library = await create();
    assert.notEqual((await library.list())[0].preview, first.preview, 'Developer image update must be visible');
    const custom = path.join(directory, 'custom.png');
    await fs.writeFile(custom, Buffer.from('custom-image'));
    await library.importMappings([{ text: ':yt:', file: custom }]);
    assert.equal((await library.list()).length, 1);
    assert.equal((await library.list())[0].bundled, false);
    const customId = library.entries[0].id;
    library = await create();
    assert.equal((await library.list())[0].id, customId);
    await library.remove(customId);
    assert.equal((await library.list())[0].source, 'youtube');
    assert.equal((await library.list())[0].bundled, true);
    await fs.writeFile(config, JSON.stringify({ emojis: [{ text: ':escape:', file: '../custom.png' }] }));
    await assert.rejects(library.loadBundledConfig(config, 'youtube'), /同梱画像/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('real encoding: GIF animation, repeated occurrences, transparency, timing and audio', { timeout: 90000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-encode-test-'));
  try {
    const input = path.join(directory, 'source video.mp4');
    const gif = path.join(directory, 'stamp.gif');
    const output = path.join(directory, 'result.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', input]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=32x32:r=2:d=0.5', '-f', 'lavfi', '-i', 'color=blue:s=32x32:r=2:d=0.5', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-loop', '0', gif]);
    const event = { assetId: 'gif', startMs: 200, durationMs: 800, elapsedMs: 0, x: 100, y: 100, speed: 1, size: 40, opacity: 0.5 };
    const progress = [];
    await runEncoder({ cwd: directory, input, output, assets: [{ id: 'gif', path: gif }],
      plan: { ...plan(), crf: 20, preset: 'fast', events: [event, { ...event, startMs: 1200, durationMs: 600 }] },
      registerProcess: () => {}, onProgress: (value) => progress.push(value),
    });
    const pixel = (time) => [...ffmpeg(['-ss', String(time), '-i', output, '-frames:v', '1', '-vf', 'crop=2:2:110:110,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])];
    const before = pixel(0.05), red = pixel(0.3), blue = pixel(0.8), gap = pixel(1.1), repeat = pixel(1.3);
    assert.ok(Math.max(...before) < 15, `before: ${before}`);
    assert.ok(red[0] > 80 && red[0] < 180 && red[2] < 25, `red with half opacity: ${red}`);
    assert.ok(blue[2] > 80 && blue[0] < 25, `animated blue: ${blue}`);
    assert.ok(Math.max(...gap) < 15, `gap: ${gap}`);
    assert.ok(repeat[0] > 80 && repeat[2] < 25, `GIF restarts: ${repeat}`);
    const audio = ffmpeg(['-i', output, '-map', '0:a:0', '-f', 's16le', '-t', '0.1', 'pipe:1']);
    assert.ok(audio.length > 0);
    assert.ok(progress.length > 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('encoding cancellation terminates the process', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv2ass-cancel-test-'));
  try {
    const input = path.join(directory, 'source.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', input]);
    await assert.rejects(runEncoder({ cwd: directory, input, output: path.join(directory, 'cancel.mp4'),
      plan: plan(), assets: [], onProgress: () => {}, registerProcess: (child) => child.once('spawn', () => child.kill()),
    }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
