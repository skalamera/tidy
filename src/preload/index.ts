import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type TidyApi } from '../shared/ipc';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
};

const api: TidyApi = {
  getView: () => ipcRenderer.invoke(IPC.getView),
  onView: (cb) => on(IPC.viewChanged, cb),
  onChatDelta: (cb) => on(IPC.chatDelta, cb),
  onNavigate: (cb) => on(IPC.navigate, cb),
  completeWelcome: () => ipcRenderer.invoke(IPC.completeWelcome),
  skipPriorYear: () => ipcRenderer.invoke(IPC.skipPriorYear),
  setApiKey: (key) => ipcRenderer.invoke(IPC.setApiKey, key),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  addPaths: (paths) => ipcRenderer.invoke(IPC.addPaths, paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  retryDocument: (id) => ipcRenderer.invoke(IPC.retryDocument, id),
  removeDocument: (id) => ipcRenderer.invoke(IPC.removeDocument, id),
  getDocumentBytes: (id) => ipcRenderer.invoke(IPC.getDocumentBytes, id),
  answer: (questionId, answer) => ipcRenderer.invoke(IPC.answer, questionId, answer),
  approve: (sectionId) => ipcRenderer.invoke(IPC.approve, sectionId),
  setScreen: (ctx) => ipcRenderer.send(IPC.setScreen, ctx),
  sendChat: (text) => ipcRenderer.invoke(IPC.sendChat, text),
  decideProposal: (id, accept) => ipcRenderer.invoke(IPC.decideProposal, id, accept),
  exportPackage: () => ipcRenderer.invoke(IPC.exportPackage),
};

contextBridge.exposeInMainWorld('tidy', api);
