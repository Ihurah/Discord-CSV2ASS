const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const version = '9.1';
const archiveName = `ffmpeg-${version}-essentials_build.zip`;
const archiveUrl = `https://www.gyan.dev/ffmpeg/builds/packages/${archiveName}`;
const archiveSha256 = 'b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd';
const outputDirectory = path.join(__dirname, '..', 'assets', 'ffmpeg-bin');
const executable = path.join(outputDirectory, 'ffmpeg.exe');

function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const file = fs.createReadStream(filename);
    file.on('data', (chunk) => hash.update(chunk));
    file.once('error', reject);
    file.once('end', () => resolve(hash.digest('hex')));
  });
}

function download(url, destination, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('FFmpeg download redirected too many times.'));
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        return download(new URL(response.headers.location, url).href, destination, redirects + 1).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`FFmpeg download failed with HTTP ${response.statusCode}.`));
        return;
      }
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.once('finish', () => file.close(resolve));
      file.once('error', reject);
      response.once('error', reject);
    }).once('error', reject);
  });
}

async function main() {
  if (fs.existsSync(executable)) {
    try {
      const result = execFileSync(executable, ['-version'], { windowsHide: true, encoding: 'utf8' });
      if (result.includes(`ffmpeg version ${version}`)) return;
    } catch {
      fs.rmSync(executable, { force: true });
    }
  }
  if (process.platform !== 'win32') throw new Error('The bundled FFmpeg build is prepared on Windows only.');

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-csv2ass-ffmpeg-'));
  const archive = path.join(tempDirectory, archiveName);
  const extraction = path.join(tempDirectory, 'extracted');
  try {
    console.log(`Downloading FFmpeg ${version} Essentials build...`);
    await download(archiveUrl, archive);
    const hash = await sha256File(archive);
    if (hash !== archiveSha256) throw new Error('FFmpeg archive SHA-256 verification failed.');

    fs.mkdirSync(extraction, { recursive: true });
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extraction)}`], { windowsHide: true, stdio: 'inherit' });

    const buildRoot = path.join(extraction, `ffmpeg-${version}-essentials_build`);
    const sourceExecutable = path.join(buildRoot, 'bin', 'ffmpeg.exe');
    if (!fs.existsSync(sourceExecutable)) throw new Error('FFmpeg executable was not found in the verified archive.');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.copyFileSync(sourceExecutable, executable);
    for (const name of fs.readdirSync(buildRoot)) {
      if (/^(license|readme|copying)/i.test(name)) {
        fs.copyFileSync(path.join(buildRoot, name), path.join(outputDirectory, name));
      }
    }
    const versionOutput = execFileSync(executable, ['-version'], { windowsHide: true, encoding: 'utf8' });
    if (!versionOutput.includes(`ffmpeg version ${version}`)) throw new Error('The FFmpeg binary reported an unexpected version.');
    console.log(`Prepared ${versionOutput.split(/\r?\n/, 1)[0]}`);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Failed to prepare FFmpeg: ${error.message}`);
  process.exitCode = 1;
});
