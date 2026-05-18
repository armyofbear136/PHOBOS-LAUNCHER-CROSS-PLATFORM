'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  close:       () => ipcRenderer.invoke('window:close'),
  minimize:    () => ipcRenderer.invoke('window:minimize'),
  openUrl:     (url) => ipcRenderer.invoke('shell:openUrl', url),
  start:       () => ipcRenderer.invoke('core:start'),
  stop:        () => ipcRenderer.invoke('core:stop'),
  download:    () => ipcRenderer.invoke('core:download'),
  checkUpdate: () => ipcRenderer.invoke('core:checkUpdate'),
  launchApp:   () => ipcRenderer.invoke('app:launch'),
  focusApp:    () => ipcRenderer.invoke('app:focus'),
  getPref:     (key)        => ipcRenderer.invoke('prefs:get', key),
  setPref:     (key, value) => ipcRenderer.invoke('prefs:set', key, value),

  onStatus:         (cb) => { ipcRenderer.on('status',          (_, d) => cb(d)); },
  onVersion:        (cb) => { ipcRenderer.on('version',         (_, d) => cb(d)); },
  onLauncherUpdate: (cb) => { ipcRenderer.on('launcher-update', (_, d) => cb(d)); },
  onAppMissing:     (cb) => { ipcRenderer.on('app-missing',     (_, d) => cb(d)); },
});