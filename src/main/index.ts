import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connect } from './ai/connect';
import { AiKeyStore } from './apiKey';
import { registerIpc } from './ipc';
import { LawSearch } from './law/search';
import { IPC } from '../shared/ipc';
import { ChatStore } from './chats';
import { fileLog } from './log';
import { buildPackage } from './pdf/package';
import { pdfTools } from './pdf/pdfTools';
import { TidyService } from './service';
import { ReturnStore } from './store';
import { loadOrCreateDataKey } from './vault';

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const EXTERNAL_OK = [
  'https://console.anthropic.com/',
  'https://aistudio.google.com/',
  'https://www.irs.gov/',
  'https://www.marylandcomptroller.gov/',
];

let win: BrowserWindow | null = null;

const writeLog = fileLog(
  () => path.join(app.getPath('userData'), 'logs', 'tidy.log'),
  () => new Date().toISOString(),
);
/** Unexpected errors go to Tidy's log (userData/logs/tidy.log) and the console; the user gets a plain sentence. */
const log = (where: string, e: unknown) => {
  writeLog(where, e);
  console.error(`[Tidy] ${where}:`, e);
};
const SOMETHING_WENT_WRONG = 'Something went wrong in Tidy. Your work is saved. If anything looks stuck, quit and reopen Tidy.';
const tellWindow = () => {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.appError, SOMETHING_WENT_WRONG);
};
// With these listeners, Electron no longer shows its raw "A JavaScript error occurred in the main process" dialog.
process.on('uncaughtException', (e) => {
  log('Uncaught error', e);
  tellWindow();
});
process.on('unhandledRejection', (e) => {
  log('Unhandled rejection', e);
  tellWindow();
});

/** Files shipped in resources/ (forms, law index) live next to the app when packaged. */
export const resourcePath = (rel: string) =>
  app.isPackaged ? path.join(process.resourcesPath, rel) : path.join(app.getAppPath(), 'resources', rel);

function isTrustedFrame(url: string | undefined): boolean {
  if (!url) return false;
  if (DEV_URL && url.startsWith(DEV_URL)) return true;
  return url.startsWith('file://') && url.includes('/renderer/index.html');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Tidy',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#F7F7F4',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.on('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_OK.some((ok) => url.startsWith(ok))) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  return win;
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  const key = await loadOrCreateDataKey(path.join(userData, 'data.key'), safeStorage, { readFile, writeFile });
  const store = await ReturnStore.open(path.join(userData, 'returns', '2025'), key, () => new Date().toISOString());
  const chats = await ChatStore.open(path.join(userData, 'returns', '2025', 'chats'), key, (file, e) =>
    log(`Reading saved chat ${file}`, e),
  );
  const law = await LawSearch.load(resourcePath('law/2025/chunks.json'));
  const service = new TidyService({
    store,
    chats,
    log,
    law,
    pdf: pdfTools,
    aiKeys: new AiKeyStore(userData, safeStorage),
    connect,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    emit: (channel, payload) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
    pickPaths: async () =>
      (
        await dialog.showOpenDialog(win!, {
          title: 'Add tax documents',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Tax documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'csv'] }],
        })
      ).filePaths,
    buildPackage: (state) => buildPackage(state, (rel) => readFile(resourcePath(rel))),
    savePath: async (name) =>
      (await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('documents'), name) })).filePath ?? null,
    writeFile: (file, bytes) => writeFile(file, bytes),
  });
  registerIpc(service, isTrustedFrame, log);
  try {
    await service.init(); // before the window exists, so the first view already knows about the saved key
  } catch (e) {
    log('Starting up', e); // still open the window: what loaded works, and the screen says what doesn't
  }
  win = createWindow();
});

app.on('window-all-closed', () => app.quit());
