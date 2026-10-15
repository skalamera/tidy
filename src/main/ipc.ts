import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import { AI_PROVIDERS } from '../shared/ai';
import { SECTION_IDS } from '../shared/state';
import type { TidyService } from './service';

const SectionId = z.enum(SECTION_IDS);
const Id = z.string().min(1).max(200);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Screen = z.object({
  view: z.enum(['welcome', 'api_key', 'section']),
  sectionId: SectionId.nullable(),
  documentId: Id.nullable(),
  page: z.number().int().positive().nullable(),
});

/** Every renderer call is checked: it must come from our own window, and its arguments must parse. A call that
 *  fails is logged, then fails in the renderer too, which tells the user. */
export function registerIpc(
  service: TidyService,
  isTrusted: (frameUrl: string | undefined) => boolean,
  log: (where: string, error: unknown) => void,
): void {
  const guard = (e: IpcMainInvokeEvent | IpcMainEvent) => {
    if (!isTrusted(e.senderFrame?.url)) throw new Error('Blocked IPC from an untrusted frame');
  };
  const handle = <T extends z.ZodTypeAny>(channel: string, args: T, fn: (a: z.infer<T>) => unknown) =>
    ipcMain.handle(channel, async (e, ...raw) => {
      guard(e);
      try {
        return await fn(args.parse(raw));
      } catch (err) {
        log(`Handling ${channel}`, err);
        throw err;
      }
    });

  handle(IPC.getView, z.tuple([]), () => service.view());
  handle(IPC.completeWelcome, z.tuple([]), () => service.completeWelcome());
  handle(IPC.skipPriorYear, z.tuple([]), () => service.skipPriorYear());
  handle(IPC.setApiKey, z.tuple([z.enum(AI_PROVIDERS), z.string().max(500)]), ([provider, key]) => service.setApiKey(provider, key));
  handle(IPC.pickFiles, z.tuple([]), () => service.pickFiles());
  handle(IPC.addPaths, z.tuple([z.array(z.string().max(4096)).max(200)]), ([paths]) => service.addPaths(paths));
  handle(IPC.retryDocument, z.tuple([Id]), ([id]) => service.retryDocument(id));
  handle(IPC.removeDocument, z.tuple([Id]), ([id]) => service.removeDocument(id));
  handle(IPC.getDocumentBytes, z.tuple([Id]), ([id]) => service.getDocumentBytes(id));
  handle(IPC.answer, z.tuple([z.string().max(300), z.string().max(2_000)]), ([q, a]) => service.answer(q, a));
  handle(IPC.approve, z.tuple([SectionId]), ([id]) => service.approve(id));
  handle(IPC.sendChat, z.tuple([z.string().min(1).max(8_000)]), ([text]) => service.sendChat(text));
  handle(IPC.newChat, z.tuple([]), () => service.newChat());
  handle(IPC.openChat, z.tuple([Id]), ([id]) => service.openChat(id));
  handle(IPC.deleteChat, z.tuple([Id]), ([id]) => service.deleteChat(id));
  handle(IPC.searchChats, z.tuple([z.object({ words: z.string().max(500), from: Day.nullable(), to: Day.nullable() })]), ([query]) =>
    service.searchChats(query),
  );
  handle(IPC.decideProposal, z.tuple([Id, z.boolean()]), ([id, accept]) => service.decideProposal(id, accept));
  handle(IPC.undoOverride, z.tuple([Id]), ([id]) => service.undoOverride(id));
  handle(IPC.exportPackage, z.tuple([]), () => service.exportPackage());
  const Passphrase = z.string().max(1_000);
  handle(IPC.exportBackup, z.tuple([Passphrase]), ([p]) => service.exportBackup(p));
  handle(IPC.restoreBackup, z.tuple([Passphrase]), ([p]) => service.restoreBackup(p));

  ipcMain.on(IPC.reportError, (e, raw) => {
    guard(e);
    const text = z.string().max(8_000).safeParse(raw);
    if (text.success) log('Screen', text.data);
  });

  ipcMain.on(IPC.setScreen, (e, raw) => {
    guard(e);
    const parsed = Screen.safeParse(raw);
    if (parsed.success) service.setScreen(parsed.data);
  });
}
