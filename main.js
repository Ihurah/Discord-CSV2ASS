const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');
const crypto = require('node:crypto');
const { MediaLibrary } = require('./media-library');
const { runEncoder, validatePlan } = require('./video-export');
const { getEncoder, detectEncoders } = require('./video-encoders');

const fsp = fs.promises;
const APP_DIR_NAMES = [
  'discord-csv2ass',
  'Discord CSV2ASS',
  'DiscordCSV2ASS',
];

function getOwnedDataPaths() {
  const localAppData = process.env.LOCALAPPDATA;
  const roamingAppData = process.env.APPDATA;
  const tempDir = process.env.TEMP;
  const candidates = [];

  [localAppData, roamingAppData, tempDir].forEach((basePath) => {
    if (!basePath) return;

    APP_DIR_NAMES.forEach((dirName) => {
      candidates.push(path.join(basePath, dirName));
    });
  });

  return [...new Set(candidates)];
}

function removeOwnedAppData() {
  getOwnedDataPaths().forEach((targetPath) => {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to remove ${targetPath}: ${error.message}`);
    }
  });
}

function handleSquirrelEvent() {
  if (process.platform !== 'win32') {
    return false;
  }

  const squirrelEvent = process.argv.find((arg) => arg.startsWith('--squirrel-'));
  if (!squirrelEvent) {
    return false;
  }

  const appFolder = path.resolve(process.execPath, '..');
  const rootFolder = path.resolve(appFolder, '..');
  const updateExe = path.join(rootFolder, 'Update.exe');
  const exeName = path.basename(process.execPath);

  const runUpdate = (args) => {
    childProcess.spawn(updateExe, args, { detached: true }).on('close', () => app.quit());
  };

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdate([`--createShortcut=${exeName}`]);
      return true;
    case '--squirrel-uninstall':
      removeOwnedAppData();
      runUpdate([`--removeShortcut=${exeName}`]);
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
}

if (handleSquirrelEvent()) {
  return;
}

let mainWindow = null;
let installedFontsPromise = null;
let libraryPromise;
let selectedVideo = null;
let exportJob = null;
let encodersPromise;

function getVideoEncoders() {
  if (!encodersPromise) encodersPromise = detectEncoders().catch((error) => { encodersPromise = null; throw error; });
  return encodersPromise;
}

ipcMain.handle('get-video-encoders', () => getVideoEncoders());

function getMediaLibrary() {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      await app.whenReady();
      const library = new MediaLibrary(path.join(app.getPath('userData'), 'emoji-library'), nativeImage);
      await library.load();
      for (const [relative, source] of [
        ['assets/emoji-map.json', 'bundled'],
        ['assets/youtube/emoji-map.json', 'youtube'],
      ]) {
        const filename = path.join(__dirname, relative);
        if (fs.existsSync(filename)) await library.loadBundledConfig(filename, source);
      }
      return library;
    })();
  }
  return libraryPromise;
}

ipcMain.handle('get-emoji-settings', async () => {
  const [library, emoji] = await Promise.all([getMediaLibrary(), import('gemoji')]);
  return { aliases: emoji.nameToEmoji, entries: await library.list() };
});

let libraryMutation = Promise.resolve();
function mutateLibrary(action) {
  const next = libraryMutation.then(async () => {
    if (exportJob) throw new Error('焼き付け中は画像の登録・削除はできません。');
    return action(await getMediaLibrary());
  });
  libraryMutation = next.catch(() => {});
  return next;
}

ipcMain.handle('add-emoji-image', (event, text) => mutateLibrary(async (library) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '文字列に割り当てる画像・GIFを選択', properties: ['openFile'],
    filters: [{ name: '画像・GIF', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  if (result.canceled) return { canceled: true };
  return { entries: await library.importMappings([{ text, file: result.filePaths[0] }]) };
}));

ipcMain.handle('add-emoji-url', (event, { text, url }) => mutateLibrary(async (library) => ({
  entries: await library.importUrl(text, url),
})));

ipcMain.handle('remove-emoji-image', (event, id) => mutateLibrary(async (library) => ({ entries: await library.remove(id) })));

ipcMain.handle('choose-burn-video', async () => {
  if (exportJob) throw new Error('焼き付け中です。');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '焼き付ける元動画を選択', properties: ['openFile'],
    filters: [{ name: '動画', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'ts'] }],
  });
  if (result.canceled) return { canceled: true };
  selectedVideo = result.filePaths[0];
  return { name: path.basename(selectedVideo) };
});

ipcMain.handle('cancel-video-export', () => {
  if (!exportJob) return false;
  exportJob.canceled = true;
  exportJob.child?.kill();
  return true;
});

ipcMain.handle('burn-video', async (event, plan) => {
  if (exportJob) throw new Error('別の動画を焼き付け中です。');
  if (!selectedVideo) throw new Error('先に元動画を選択してください。');
  validatePlan(plan);
  const encoding = getEncoder(plan.encoder);
  const input = selectedVideo;
  const job = { child: null, canceled: false };
  job.done = new Promise((resolve) => { job.finish = resolve; });
  exportJob = job;
  let workDir, partialOutput;
  try {
    const available = (await getVideoEncoders()).find((item) => item.id === encoding.id);
    if (!available?.available) throw new Error(`${encoding.label}は利用できません。${available?.reason || '別のエンコーダーを選択してください。'}`);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'コメント付き動画を保存',
      defaultPath: path.join(path.dirname(input), `${path.parse(input).name}-comments.${encoding.extension}`),
      filters: [{ name: encoding.extension.toUpperCase(), extensions: [encoding.extension] }],
    });
    if (result.canceled || !result.filePath || job.canceled) return { canceled: true };
    const destination = result.filePath;
    if (path.extname(destination).toLowerCase() !== `.${encoding.extension}`) throw new Error(`拡張子を.${encoding.extension}にして保存してください。`);
    const canonical = async (filename) => {
      const resolved = await fsp.realpath(filename).catch(() => path.resolve(filename));
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    if (await canonical(input) === await canonical(destination)) throw new Error('元動画とは異なる保存先を選択してください。');
    workDir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'csv2ass-burn-'));
    partialOutput = path.join(path.dirname(destination), `.csv2ass-${crypto.randomUUID()}.${encoding.extension}`);
    await libraryMutation;
    const library = await getMediaLibrary();
    const used = new Set(plan.events.map((item) => item.assetId));
    const assets = [];
    for (const id of used) {
      const entry = library.getEntries().find((item) => item.id === id);
      if (entry) {
        let filename = library.assetPath(entry);
        if (entry.bundledPath) {
          // External FFmpeg cannot read files stored inside app.asar.
          filename = path.join(workDir, `bundled-${assets.length}${path.extname(entry.file)}`);
          await fsp.writeFile(filename, await fsp.readFile(library.assetPath(entry)));
        }
        assets.push({ id, path: filename });
      }
      else {
        const dataUrl = plan.unicodeImages?.[id];
        if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 1024 * 1024) throw new Error('絵文字の画像が見つかりません。');
        const data = Buffer.from(dataUrl.split(',')[1], 'base64');
        if (nativeImage.createFromBuffer(data).isEmpty()) throw new Error('絵文字の画像が不正です。');
        const filename = path.join(workDir, `unicode-${assets.length}.png`);
        await fsp.writeFile(filename, data);
        assets.push({ id, path: filename });
      }
    }
    if (job.canceled) return { canceled: true };
    await runEncoder({
      cwd: workDir, input, output: partialOutput, plan, assets,
      registerProcess: (child) => { job.child = child; if (job.canceled) child.kill(); },
      onProgress: (progress) => { if (!event.sender.isDestroyed()) event.sender.send('video-export-progress', progress); },
    });
    if (job.canceled) return { canceled: true };
    await fsp.rename(partialOutput, destination);
    partialOutput = null;
    return { canceled: false, filePath: destination };
  } catch (error) {
    if (job.canceled) return { canceled: true };
    throw new Error(`焼き付けに失敗しました。\n${error.message.slice(-4000)}`);
  } finally {
    try {
      if (partialOutput) await fsp.rm(partialOutput, { force: true });
      if (workDir) await fsp.rm(workDir, { recursive: true, force: true });
    } finally {
      exportJob = null;
      job.finish();
    }
  }
});

function getInstalledFonts() {
  if (installedFontsPromise) {
    return installedFontsPromise;
  }

  installedFontsPromise = new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }

    const command =
      '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ' +
      'Add-Type -AssemblyName System.Drawing; ' +
      '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ' +
      'ForEach-Object { $_.Name } | Sort-Object -Unique';
    const powershellPath = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );

    childProcess.execFile(
      powershellPath,
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          console.warn(`Failed to load installed fonts: ${error.message}`);
          resolve([]);
          return;
        }

        const fonts = [...new Set(
          stdout
            .split(/\r?\n/)
            .map((font) => font.trim())
            .filter(Boolean),
        )].sort((a, b) => a.localeCompare(b, 'ja'));
        resolve(fonts);
      },
    );
  });

  return installedFontsPromise;
}

ipcMain.handle('get-installed-fonts', () => getInstalledFonts());

ipcMain.handle('save-ass-file', async (event, { defaultPath, content }) => {
  const result = await dialog.showSaveDialog({
    title: 'ASSファイルを保存',
    defaultPath,
    filters: [{ name: 'ASS Subtitle', extensions: ['ass'] }],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fsp.writeFile(result.filePath, content, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 1220,
    minHeight: 780,
    title: 'Discord CSV2ASS',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', (event) => {
    if (!exportJob) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', buttons: ['焼き付けを続ける', '中止して終了'], defaultId: 0, cancelId: 0,
      message: '動画の焼き付け中です。中止して終了しますか？',
    });
    if (choice === 0) event.preventDefault();
    else { exportJob.canceled = true; exportJob.child?.kill(); }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('before-quit', (event) => {
  if (!exportJob) return;
  event.preventDefault();
  exportJob.canceled = true;
  exportJob.child?.kill();
  exportJob.done.finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

