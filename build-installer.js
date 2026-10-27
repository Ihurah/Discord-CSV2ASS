const winstaller = require("electron-winstaller");
const path = require("path");
const fs = require("fs");

async function createInstaller() {
  console.log("Creating Windows Installer...");

  const appDirectory = path.resolve(
    __dirname,
    process.argv[2] || "dist/Discord CSV2ASS-win32-x64",
  );
  const outputDirectory = path.join(__dirname, "dist/installer");
  const iconPath = path.join(__dirname, "assets/icon.ico");

  // Check if packaged app directory exists
  if (!fs.existsSync(appDirectory)) {
    console.error(`Error: App directory not found at: ${appDirectory}`);
    console.error(
      'Please run "npm run build" first to package the application.',
    );
    process.exit(1);
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });

  // Setup options
  const options = {
    appDirectory: appDirectory,
    outputDirectory: outputDirectory,
    authors: "Ihurah_com",
    owners: "Ihurah_com",
    exe: "Discord CSV2ASS.exe",
    setupExe: "DiscordCSV2ASS-Setup.exe",
    title: "Discord CSV2ASS",
    description: "Discord CSV log to ASS subtitle converter",
    noMsi: true,
    noDelta: true,
  };

  // Only include icon if it exists to avoid errors
  if (fs.existsSync(iconPath)) {
    options.setupIcon = iconPath;
    console.log(`Using icon: ${iconPath}`);
  } else {
    console.log(
      "Warning: assets/icon.ico not found. Building installer without custom icon.",
    );
  }

  try {
    await winstaller.createWindowsInstaller(options);
    console.log("Successfully created installer!");
    console.log(`Installer saved in: ${outputDirectory}`);
  } catch (e) {
    console.error(`Installer creation failed: ${e.message}`);
    process.exit(1);
  }
}

createInstaller();
