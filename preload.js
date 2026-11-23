const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),
  save: (data) => ipcRenderer.invoke('save', data),
  initialFiles: () => ipcRenderer.invoke('initial-files'),
  importDialog: () => ipcRenderer.invoke('import-dialog'),
  exportDialog: (opts) => ipcRenderer.invoke('export-dialog', opts),
  pickPhoto: () => ipcRenderer.invoke('pick-photo'),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  log: (msg) => ipcRenderer.invoke('log', msg),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  icloud: {
    status: () => ipcRenderer.invoke('icloud-status'),
    connect: (appleId, pass) => ipcRenderer.invoke('icloud-connect', { appleId, pass }),
    disconnect: () => ipcRenderer.invoke('icloud-disconnect'),
    book: () => ipcRenderer.invoke('dav-book'),
    list: () => ipcRenderer.invoke('dav-list'),
    multiget: (hrefs) => ipcRenderer.invoke('dav-multiget', hrefs),
    put: (href, data, etag) => ipcRenderer.invoke('dav-put', { href, data, etag }),
    del: (href, etag) => ipcRenderer.invoke('dav-del', { href, etag })
  },
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, texts) => cb(texts)),
  platform: process.platform
});
