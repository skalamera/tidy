import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import { SECTION_IDS } from '../shared/state';
import type { TidyService } from './service';

const SectionId = z.enum(SECTION_IDS);
const Id = z.string().min(1).max(200);
const Screen = z.object({
  view: z.enum(['welcome', 'api_key', 'section']),
  sectionId: SectionId.nullable(),
  documentId: Id.nullable(),
  page: z.number().int().positive().nullable(),
});

/** Every renderer call is checked: it must come from our own window, and its arguments must parse. */
export function registerIpc(service: TidyService, isTrusted: (frameUrl: string | undefined) => boolean): void {
  const guard = (e: IpcMainInvokeEvent | IpcMainEvent) => {
    if (!isTrusted(e.senderFrame?.url)) throw new Error('Blocked IPC from an untrusted frame');
  };
  const handle = <T extends z.ZodTypeAny>(channel: string, args: T, fn: (a: z.infer<T>) => unknown) =>
    ipcMain.handle(channel, (e, ...raw) => {
      guard(e);
      return fn(args.parse(raw));
    });

  handle(IPC.getView, z.tuple([]), () => service.view());
  handle(IPC.completeWelcome, z.tuple([]), () => service.completeWelcome());
  handle(IPC.skipPriorYear, z.tuple([]), () => service.skipPriorYear());
  handle(IPC.setApiKey, z.tuple([z.string().max(500)]), ([key]) => service.setApiKey(key));
  handle(IPC.pickFiles, z.tuple([]), () => service.pickFiles());
  handle(IPC.addPaths, z.tuple([z.array(z.string().max(4096)).max(200)]), ([paths]) => service.addPaths(paths));
  handle(IPC.retryDocument, z.tuple([Id]), ([id]) => service.retryDocument(id));
  handle(IPC.removeDocument, z.tuple([Id]), ([id]) => service.removeDocument(id));
  handle(IPC.getDocumentBytes, z.tuple([Id]), ([id]) => service.getDocumentBytes(id));
  handle(IPC.answer, z.tuple([z.string().max(300), z.string().max(2_000)]), ([q, a]) => service.answer(q, a));
  handle(IPC.approve, z.tuple([SectionId]), ([id]) => service.approve(id));
  handle(IPC.sendChat, z.tuple([z.string().min(1).max(8_000)]), ([text]) => service.sendChat(text));
  handle(IPC.decideProposal, z.tuple([Id, z.boolean()]), ([id, accept]) => service.decideProposal(id, accept));
  handle(IPC.exportPackage, z.tuple([]), () => service.exportPackage());

  ipcMain.on(IPC.setScreen, (e, raw) => {
    guard(e);
    const parsed = Screen.safeParse(raw);
    if (parsed.success) service.setScreen(parsed.data);
  });
}
