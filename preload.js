const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getInstalledFonts: () => ipcRenderer.invoke('get-installed-fonts'),
  saveAssFile: (payload) => ipcRenderer.invoke('save-ass-file', payload),
  getEmojiSettings: () => ipcRenderer.invoke('get-emoji-settings'),
  addEmojiImage: (text) => ipcRenderer.invoke('add-emoji-image', text),
  addEmojiUrl: (payload) => ipcRenderer.invoke('add-emoji-url', payload),
  removeEmojiImage: (id) => ipcRenderer.invoke('remove-emoji-image', id),
  chooseBurnVideo: () => ipcRenderer.invoke('choose-burn-video'),
  getVideoEncoders: () => ipcRenderer.invoke('get-video-encoders'),
  burnVideo: (plan) => ipcRenderer.invoke('burn-video', plan),
  cancelVideoExport: () => ipcRenderer.invoke('cancel-video-export'),
  onVideoExportProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('video-export-progress', listener);
    return () => ipcRenderer.removeListener('video-export-progress', listener);
  },
});
