'use strict';
// Schmale, feste Schnittstelle zwischen Oberfläche und Hauptprozess (keine Node-Rechte in der Oberfläche).
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['state', 'content', 'status', 'maintenance:open'];

contextBridge.exposeInMainWorld('plinth', {
  getState: () => ipcRenderer.invoke('state:get'),
  submitSetup: (data) => ipcRenderer.invoke('setup:submit', data),
  cancelSetup: () => ipcRenderer.invoke('setup:cancel'),
  checkPin: (pin) => ipcRenderer.invoke('maintenance:pin', pin),
  action: (action, extra = {}) => ipcRenderer.invoke('maintenance:action', { action, ...extra }),
  reportError: (msg) => ipcRenderer.send('renderer:error', msg),
  alive: () => ipcRenderer.send('renderer:alive'),
  on: (channel, cb) => {
    if (!CHANNELS.includes(channel)) throw new Error(`Unbekannter Kanal ${channel}`);
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
