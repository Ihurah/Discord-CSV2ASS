const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

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

  mainWindow.loadFile('index.html');
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

