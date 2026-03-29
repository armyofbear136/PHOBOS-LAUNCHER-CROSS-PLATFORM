'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  close:     () => ipcRenderer.invoke('window:close'),
  minimize:  () => ipcRenderer.invoke('window:minimize'),
  openUrl:   (url) => ipcRenderer.invoke('shell:openUrl', url),
  start:     () => ipcRenderer.invoke('core:start'),
  stop:      () => ipcRenderer.invoke('core:stop'),
  checkUpdate: () => ipcRenderer.invoke('core:checkUpdate'),

  onStatus:  (cb) => { ipcRenderer.on('status', (_, d) => cb(d)); },
  onVersion: (cb) => { ipcRenderer.on('version', (_, d) => cb(d)); },
});
