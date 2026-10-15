import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { connect } from './ai/connect';
import { AiKeyStore } from './apiKey';
import { registerIpc } from './ipc';
import { trustedFrame } from './trust';
import { LawSearch } from './law/search';
import { IPC } from '../shared/ipc';
import { ChatStore } from './chats';
import { fileLog } from './log';
import { buildPackage } from './pdf/package';
import { pdfTools } from './pdf/pdfTools';
import { TidyService } from './service';
import { ReturnStore } from './store';
import { loadOrCreateDataKey, writeDurably } from './vault';

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

const run = promisify(execFile);
const RENDERER_URL = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
const isTrustedFrame = (url: string | undefined) => trustedFrame(url, DEV_URL, RENDERER_URL);

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

/** The menu: the standard macOS ones, plus File > Back Up / Restore (the passphrase is asked for in the window). */
function setMenu(): void {
  const prompt = (mode: 'export' | 'restore') => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.backupPrompt, mode);
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'File',
        submenu: [
          { label: 'Back Up My Return…', accelerator: 'CmdOrCtrl+Shift+B', click: () => prompt('export') },
          { label: 'Restore From Backup…', click: () => prompt('restore') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      { role: 'windowMenu' },
    ]),
  );
}

/** Why the saved return couldn't be opened, in a sentence. */
function openFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Keychain|decrypt/i.test(msg)) return 'The macOS Keychain didn’t give Tidy the key that unlocks your saved return.';
  if (/authenticate data|not a Tidy vault file|JSON/i.test(msg))
    return 'Your saved return is damaged, and none of Tidy’s automatic backups could be read.';
  return `Tidy hit an error opening it (${msg}).`;
}

async function openData(userData: string) {
  const key = await loadOrCreateDataKey(path.join(userData, 'data.key'), safeStorage, { readFile, writeFile: writeDurably });
  const store = await ReturnStore.open(path.join(userData, 'returns', '2025'), key, () => new Date().toISOString());
  const chats = await ChatStore.open(path.join(userData, 'returns', '2025', 'chats'), key, (file, e) =>
    log(`Reading saved chat ${file}`, e),
  );
  return { store, chats };
}

/** Moves the unreadable data into a dated folder, so starting over never deletes anything. */
async function setAside(userData: string): Promise<string> {
  const aside = path.join(userData, `Unreadable ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`);
  await mkdir(aside, { recursive: true });
  for (const name of ['data.key', 'returns']) await rename(path.join(userData, name), path.join(aside, name)).catch(() => undefined);
  return aside;
}

if (!app.requestSingleInstanceLock()) {
  // Another Tidy is open on this Mac: two copies would overwrite each other's saves.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
}

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  setMenu();
  let data: Awaited<ReturnType<typeof openData>>;
  try {
    data = await openData(userData);
  } catch (e) {
    log('Opening the saved return', e);
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      message: 'Tidy couldn’t open your saved return',
      detail: `${openFailure(e)}\n\nTidy can start with an empty return. Your old files are kept in Tidy’s folder, not deleted. If you saved a backup file, restore it next with File > Restore From Backup.`,
      buttons: ['Quit', 'Start With an Empty Return', 'Show Tidy’s Log'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 2) shell.showItemInFolder(path.join(userData, 'logs', 'tidy.log'));
    if (choice !== 1) {
      app.quit();
      return;
    }
    try {
      await setAside(userData);
      data = await openData(userData);
    } catch (e2) {
      log('Starting with an empty return', e2);
      dialog.showErrorBox('Tidy can’t start', openFailure(e2));
      app.quit();
      return;
    }
  }
  const { store, chats } = data;
  let law: LawSearch;
  try {
    law = await LawSearch.load(resourcePath('law/2025/chunks.json'));
  } catch (e) {
    log('Loading the instructions index', e); // chat still works; it just can't quote the instructions
    law = LawSearch.fromChunks([]);
  }
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
          filters: [{ name: 'Tax documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'heif', 'csv'] }],
        })
      ).filePaths,
    heicToJpeg: async (file) => {
      const dir = await mkdtemp(path.join(app.getPath('temp'), 'tidy-heic-'));
      try {
        const out = path.join(dir, 'photo.jpg');
        // macOS's own converter. At most 3,000 pixels on the long side keeps the photo under the AIs' size limits.
        await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '3000', file, '--out', out]);
        return await readFile(out);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    buildPackage: (state) => buildPackage(state, (rel) => readFile(resourcePath(rel))),
    savePath: async (name) =>
      (await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('documents'), name) })).filePath ?? null,
    writeFile: (file, bytes) => writeFile(file, bytes),
    pickBackupFile: async () =>
      (
        await dialog.showOpenDialog(win!, {
          title: 'Restore a Tidy backup',
          properties: ['openFile'],
          filters: [{ name: 'Tidy backup', extensions: ['tidybackup'] }],
        })
      ).filePaths[0] ?? null,
    readFile: (file) => readFile(file),
  });
  registerIpc(service, isTrustedFrame, log);
  try {
    await service.init(); // before the window exists, so the first view already knows about the saved key
  } catch (e) {
    log('Starting up', e); // still open the window: what loaded works, and the screen says what doesn't
  }
  win = createWindow();
  if (store.recoveredFrom) {
    const when = new Date(store.recoveredFrom).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    win.webContents.once('did-finish-load', () =>
      win?.webContents.send(
        IPC.appError,
        `Tidy couldn’t read your latest save, so it opened the automatic backup from ${when}. Check your most recent answers.`,
      ),
    );
  }
}

app.on('window-all-closed', () => app.quit());
