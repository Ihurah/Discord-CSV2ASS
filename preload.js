const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getInstalledFonts: () => ipcRenderer.invoke('get-installed-fonts'),
  saveAssFile: (payload) => ipcRenderer.invoke('save-ass-file', payload),
});
