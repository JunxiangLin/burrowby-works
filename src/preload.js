// Bridge between the sandboxed renderers and the main process. Renderers never
// run Claude or touch the disk themselves; the engine in the main process does.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// Shared factory API, used by the pet overlay and the main window.
const works = {
  getState: invoke('works:state'),
  cliStatus: invoke('works:cli-status'),
  createJob: invoke('works:create-job'),
  stopJob: invoke('works:stop-job'),
  retryJob: invoke('works:retry-job'),
  deleteJobs: invoke('works:delete-jobs'),
  clearFinished: invoke('works:clear-finished'),
  setFactory: invoke('works:set-factory'),
  retireWorker: invoke('works:retire-worker'),
  upsert: invoke('works:upsert'),
  remove: invoke('works:remove'),
  sendTask: invoke('works:send-task'),
  exportAudit: invoke('works:export-audit'),
  sampleProject: invoke('works:sample-project'),
  suggestTasks: invoke('works:suggest-tasks'),
  askForeman: invoke('works:ask'),
  stopForeman: invoke('works:stop-foreman'),
  clearChat: invoke('works:clear-chat'),
  exportData: invoke('works:export'),
  stopAll: invoke('works:stop-all'),
  acceptProposals: invoke('works:accept-proposals'),
  setRepo: invoke('works:set-repo'),
  listPrs: invoke('works:list-prs'),
  mergePr: invoke('works:merge-pr'),
  releaseToProd: invoke('works:release'),
  releasePreview: invoke('works:release-preview'),
  repoInfo: invoke('works:repo-info'),
  openSettings: () => ipcRenderer.send('settings:open'),
  openApp: (view) => ipcRenderer.send('app:open', view),
  petCommand: (cmd) => ipcRenderer.send('pet:command', cmd),
  onPatch: on('works:patch'),
  onReset: on('works:reset'),
  onNotice: on('works:notice'),
  onCliStatus: on('cli-status'),
  onShowView: on('show-view'),
};
contextBridge.exposeInMainWorld('works', works);

// Desktop-pet overlay extras.
contextBridge.exposeInMainWorld('petApi', {
  setInteractive: (value) => ipcRenderer.send('overlay:set-interactive', !!value),
  focus: () => ipcRenderer.send('overlay:focus'),
  showMenu: () => ipcRenderer.send('pet:menu'),
  getConfig: invoke('config:get'),
  onConfig: on('config'),
  onOpenChat: on('open-chat'),
  onResetPosition: on('reset-position'),
  onCursor: on('cursor'),
});

contextBridge.exposeInMainWorld('settings', {
  status: invoke('settings:status'),
  recheck: invoke('settings:recheck'),
  saveConfig: invoke('settings:save-config'),
  setForeman: invoke('settings:set-foreman'),
  importData: invoke('settings:import'),
  openDataFolder: invoke('settings:open-data'),
  onCliStatus: on('cli-status'),
});
