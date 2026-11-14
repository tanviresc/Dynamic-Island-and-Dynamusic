/**
 * Electron API Shim for the Dynamusic (ByTune) Node Sidecar.
 * Provides all Electron main-process primitives (`app`, `ipcMain`, `BrowserWindow`,
 * `dialog`, `shell`, `session`, `protocol`, `safeStorage`, `clipboard`, `nativeImage`,
 * `Menu`, `Tray`, `powerMonitor`, `screen`) in standard Node.js on Windows.
 */
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";

export type IpcMainEvent = {
  sender: any;
  senderFrame: { url: string };
  preventDefault: () => void;
};
export type IpcMainInvokeEvent = IpcMainEvent;

const sseBroadcasters = new Set<(channel: string, ...args: any[]) => void>();

export function onWebContentsSend(fn: (channel: string, ...args: any[]) => void): () => void {
  sseBroadcasters.add(fn);
  return () => sseBroadcasters.delete(fn);
}

function broadcastToRenderer(channel: string, ...args: any[]): void {
  for (const fn of sseBroadcasters) {
    try {
      fn(channel, ...args);
    } catch {
      /* ignore */
    }
  }
}

const appDataDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
let userDataDir = path.join(appDataDir, "Dynamusic");
try {
  fs.mkdirSync(path.join(userDataDir, "data"), { recursive: true });
} catch {
  userDataDir = path.join(process.cwd(), ".dynamusic-data");
  try {
    fs.mkdirSync(path.join(userDataDir, "data"), { recursive: true });
  } catch {
    /* ignore */
  }
}

const appEmitter = new EventEmitter();

export interface AppShim {
  getPath(name: string): string;
  getLocale(): string;
  getLocaleCountryCode(): string;
  getVersion(): string;
  getAppPath(): string;
  isPackaged: boolean;
  isReady(): boolean;
  whenReady(): Promise<void>;
  requestSingleInstanceLock(): boolean;
  setAppUserModelId(id: string): void;
  setAsDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean;
  isDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean;
  setAboutPanelOptions(opts: any): void;
  commandLine: { appendSwitch(sw: string, val?: string): void };
  dock: { setIcon(icon: any): void };
  on(event: "second-instance", listener: (event: any, argv: string[]) => void): this;
  on(event: string, listener: (event: any, arg: string) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  quit(): void;
  exit(code?: number): void;
}

export const app: AppShim = {
  getPath(name: string): string {
    switch (name) {
      case "userData":
        return userDataDir;
      case "appData":
        return appDataDir;
      case "music":
        return path.join(os.homedir(), "Music");
      case "downloads":
        return path.join(os.homedir(), "Downloads");
      case "home":
        return os.homedir();
      case "temp":
        return os.tmpdir();
      default:
        return userDataDir;
    }
  },
  getLocale(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
    } catch {
      return "en-US";
    }
  },
  getLocaleCountryCode(): string {
    try {
      const loc = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
      const parts = loc.split(/[-_]/);
      return (parts[1] || "US").toUpperCase();
    } catch {
      return "US";
    }
  },
  getVersion(): string {
    return "1.1.0";
  },
  getAppPath(): string {
    return process.cwd();
  },
  isPackaged: false,
  isReady(): boolean {
    return true;
  },
  whenReady(): Promise<void> {
    return Promise.resolve();
  },
  requestSingleInstanceLock(): boolean {
    return true;
  },
  setAppUserModelId(_id: string): void {},
  setAsDefaultProtocolClient(_protocol: string, _path?: string, _args?: string[]): boolean {
    return true;
  },
  isDefaultProtocolClient(_protocol: string, _path?: string, _args?: string[]): boolean {
    return true;
  },
  setAboutPanelOptions(_opts: any): void {},
  commandLine: {
    appendSwitch(_sw: string, _val?: string): void {},
  },
  dock: {
    setIcon(_icon: any): void {},
  },
  on(event: string, listener: (...args: any[]) => void) {
    appEmitter.on(event, listener);
    return this;
  },
  once(event: string, listener: (...args: any[]) => void) {
    appEmitter.once(event, listener);
    return this;
  },
  quit(): void {},
  exit(_code?: number): void {},
};

const ipcHandlers = new Map<string, (event: IpcMainInvokeEvent, ...args: any[]) => any>();
const ipcListeners = new Map<string, ((event: IpcMainEvent, ...args: any[]) => void)[]>();

export const ipcMain = {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
    ipcHandlers.set(channel, listener);
  },
  on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
    const list = ipcListeners.get(channel) ?? [];
    list.push(listener);
    ipcListeners.set(channel, list);
  },
  removeHandler(channel: string): void {
    ipcHandlers.delete(channel);
  },
};

let primaryWindow: BrowserWindow | null = null;
const allWindows = new Set<BrowserWindow>();

export async function invokeIpcChannel(channel: string, args: any[] = []): Promise<any> {
  const win = primaryWindow;
  const event: IpcMainInvokeEvent = {
    sender: win?.webContents ?? null,
    senderFrame: win?.webContents?.mainFrame ?? { url: "" },
    preventDefault: () => {},
  };
  const handler = ipcHandlers.get(channel);
  if (handler) {
    return await handler(event, ...args);
  }
  const listeners = ipcListeners.get(channel);
  if (listeners && listeners.length > 0) {
    for (const fn of listeners) {
      fn(event, ...args);
    }
    return null;
  }
  throw new Error(`No IPC handler registered for channel: ${channel}`);
}

class SessionShim extends EventEmitter {
  cookies = new EventEmitter() as EventEmitter & {
    removeListener: (ev: string, fn: any) => any;
  };
  webRequest = {
    onBeforeSendHeaders(
      _filter: any,
      _listener?: (details: { requestHeaders: Record<string, string> }, callback: (res: any) => void) => void
    ): void {},
    onCompleted(
      _filter: any,
      _listener?: (details: { statusCode: number; error?: string; url: string }) => void
    ): void {},
  };
  setPermissionRequestHandler(
    _handler: ((wc: any, permission: string, callback: (allow: boolean) => void) => void) | null
  ): void {}
  setPermissionCheckHandler(_handler: ((...args: any[]) => boolean) | null): void {}
  setUserAgent(_ua: string): void {}
  async clearStorageData(): Promise<void> {}
}

const defaultSessionInstance = new SessionShim();
const partitions = new Map<string, SessionShim>();

export const session = {
  defaultSession: defaultSessionInstance,
  fromPartition(part: string): SessionShim {
    let s = partitions.get(part);
    if (!s) {
      s = new SessionShim();
      partitions.set(part, s);
    }
    return s;
  },
};

export class BrowserWindow extends EventEmitter {
  private destroyed = false;
  private maximized = false;
  private minimized = false;
  private fullScreen = false;
  private bounds = { x: 100, y: 100, width: 1280, height: 820 };
  public webContents: {
    mainFrame: { url: string };
    session: SessionShim;
    send: (channel: string, ...args: any[]) => void;
    on: (ev: string, fn: (event: any, ...args: any[]) => void) => void;
    setWindowOpenHandler: (fn: (details: { url: string }) => any) => void;
    focus: () => void;
    invalidate: () => void;
    toggleDevTools: () => void;
    reload: () => void;
  };

  constructor(opts?: any) {
    super();
    if (opts?.width && opts?.height) {
      this.bounds.width = opts.width;
      this.bounds.height = opts.height;
    }
    const part = opts?.webPreferences?.partition;
    const ses = part ? session.fromPartition(part) : defaultSessionInstance;
    const wcEmitter = new EventEmitter();
    this.webContents = {
      mainFrame: { url: "" },
      session: ses,
      send: (channel: string, ...args: any[]) => {
        broadcastToRenderer(channel, ...args);
      },
      on: (ev: string, fn: (event: any, ...args: any[]) => void) => {
        wcEmitter.on(ev, fn);
      },
      setWindowOpenHandler: (_fn: (details: { url: string }) => any) => {},
      focus: () => {},
      invalidate: () => {},
      toggleDevTools: () => {},
      reload: () => {
        broadcastToRenderer("window:reload");
      },
    };
    if (!primaryWindow) {
      primaryWindow = this;
    }
    allWindows.add(this);
    setTimeout(() => {
      this.emit("ready-to-show");
      this.emit("show");
    }, 10);
  }

  static getAllWindows(): BrowserWindow[] {
    return [...allWindows];
  }

  async loadURL(url: string): Promise<void> {
    this.webContents.mainFrame.url = url;
    if (url.includes("accounts.spotify.com/login")) {
      void promptSpotifyCookieForSession(this.webContents.session, () => this.close());
    }
  }

  async loadFile(filePath: string, _opts?: any): Promise<void> {
    this.webContents.mainFrame.url = filePath;
  }

  destroy(): void {
    this.close();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  isMaximized(): boolean {
    return this.maximized;
  }
  isFullScreen(): boolean {
    return this.fullScreen;
  }
  getNormalBounds() {
    return { ...this.bounds };
  }
  getBounds() {
    return { ...this.bounds };
  }
  setBounds(b: Partial<typeof this.bounds>): void {
    Object.assign(this.bounds, b);
  }
  setMinimumSize(_w: number, _h: number): void {}
  setMaximumSize(_w: number, _h: number): void {}
  setAlwaysOnTop(_flag: boolean, _level?: string): void {}
  setVisibleOnAllWorkspaces(_flag: boolean, _opts?: any): void {}
  show(): void {
    this.emit("show");
  }
  showInactive(): void {
    this.emit("show");
  }
  hide(): void {
    this.emit("hide");
  }
  focus(): void {
    this.emit("focus");
  }
  minimize(): void {
    this.minimized = true;
  }
  restore(): void {
    this.minimized = false;
  }
  maximize(): void {
    this.maximized = true;
    this.emit("maximize");
  }
  unmaximize(): void {
    this.maximized = false;
    this.emit("unmaximize");
  }
  setFullScreen(fsState: boolean): void {
    this.fullScreen = fsState;
    this.emit(fsState ? "enter-full-screen" : "leave-full-screen");
  }
  setTitleBarOverlay(_opts: any): void {}
  setBackgroundColor(_color: string): void {}
  setBackgroundMaterial(_mat: string): void {}
  setThumbarButtons(_buttons: any[]): boolean {
    return true;
  }
  close(): void {
    this.destroyed = true;
    allWindows.delete(this);
    this.emit("closed");
  }
}

async function promptSpotifyCookieForSession(ses: SessionShim, onClose: () => void): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Start-Process "https://open.spotify.com"
$form = New-Object System.Windows.Forms.Form
$form.Text = "Connect Spotify to Dynamusic"
$form.Size = New-Object System.Drawing.Size(480, 230)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 18)
$form.ForeColor = [System.Drawing.Color]::White
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

$label = New-Object System.Windows.Forms.Label
$label.Text = "1. Sign in to Spotify in the browser tab that just opened." + [Environment]::NewLine + "2. Press F12 -> Application -> Cookies -> https://open.spotify.com" + [Environment]::NewLine + "3. Copy the value of 'sp_dc' and paste it below:"
$label.Location = New-Object System.Drawing.Point(16, 16)
$label.Size = New-Object System.Drawing.Size(440, 64)
$form.Controls.Add($label)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Location = New-Object System.Drawing.Point(16, 90)
$textBox.Size = New-Object System.Drawing.Size(432, 28)
$form.Controls.Add($textBox)

$okButton = New-Object System.Windows.Forms.Button
$okButton.Location = New-Object System.Drawing.Point(280, 136)
$okButton.Size = New-Object System.Drawing.Size(80, 32)
$okButton.Text = "Connect"
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $okButton
$form.Controls.Add($okButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Location = New-Object System.Drawing.Point(368, 136)
$cancelButton.Size = New-Object System.Drawing.Size(80, 32)
$cancelButton.Text = "Cancel"
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancelButton
$form.Controls.Add($cancelButton)

$result = $form.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $textBox.Text.Trim()
}
`;
  execFile("powershell.exe", ["-NoProfile", "-Sta", "-Command", script], (err, stdout) => {
    const val = (stdout || "").trim();
    if (!err && val.length >= 20) {
      ses.cookies.emit("changed", {}, { name: "sp_dc", domain: ".spotify.com", value: val }, "explicit", false);
    } else {
      onClose();
    }
  });
}

function runPsDialog(psCode: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-Sta", "-Command", psCode], (err, stdout) => {
      if (err) {
        resolve("");
        return;
      }
      resolve((stdout || "").trim());
    });
  });
}

export const dialog = {
  async showOpenDialog(_winOrOpts: any, maybeOpts?: any): Promise<{ canceled: boolean; filePaths: string[] }> {
    const opts = maybeOpts ?? _winOrOpts ?? {};
    const props: string[] = opts.properties ?? [];
    if (props.includes("openDirectory")) {
      const out = await runPsDialog(`
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = ${JSON.stringify(opts.title || "Select folder")}
$dlg.ShowNewFolderButton = $true
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
}
`);
      return out ? { canceled: false, filePaths: [out] } : { canceled: true, filePaths: [] };
    }
    const exts: string[] = opts.filters?.[0]?.extensions ?? ["*"];
    const filterPattern = exts.map((e: string) => `*.${e}`).join(";");
    const filterName = opts.filters?.[0]?.name || "Files";
    const out = await runPsDialog(`
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = ${JSON.stringify(opts.title || "Open file")}
$dlg.Filter = ${JSON.stringify(`${filterName} (${filterPattern})|${filterPattern}|All files (*.*)|*.*`)}
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.FileName
}
`);
    return out ? { canceled: false, filePaths: [out] } : { canceled: true, filePaths: [] };
  },

  async showSaveDialog(_winOrOpts: any, maybeOpts?: any): Promise<{ canceled: boolean; filePath?: string }> {
    const opts = maybeOpts ?? _winOrOpts ?? {};
    const exts: string[] = opts.filters?.[0]?.extensions ?? ["*"];
    const filterPattern = exts.map((e: string) => `*.${e}`).join(";");
    const filterName = opts.filters?.[0]?.name || "Files";
    const out = await runPsDialog(`
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.SaveFileDialog
$dlg.Title = ${JSON.stringify(opts.title || "Save file")}
$dlg.FileName = ${JSON.stringify(opts.defaultPath || "")}
$dlg.Filter = ${JSON.stringify(`${filterName} (${filterPattern})|${filterPattern}|All files (*.*)|*.*`)}
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.FileName
}
`);
    return out ? { canceled: false, filePath: out } : { canceled: true };
  },
};

export const shell = {
  async openExternal(url: string): Promise<void> {
    execFile("powershell.exe", ["-NoProfile", "-Command", "Start-Process", url], () => {});
  },
  async openPath(p: string): Promise<string> {
    execFile("explorer.exe", [p], () => {});
    return "";
  },
  showItemInFolder(p: string): void {
    execFile("explorer.exe", [`/select,${p}`], () => {});
  },
};

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return false;
  },
  encryptString(plainText: string): Buffer {
    return Buffer.from(plainText, "utf8");
  },
  decryptString(encrypted: Buffer): string {
    return encrypted.toString("utf8");
  },
};

export type NativeImage = {
  isEmpty: () => boolean;
  addRepresentation: (_opts: any) => void;
};

export const nativeImage = {
  createEmpty(): NativeImage {
    return {
      isEmpty: () => false,
      addRepresentation: () => {},
    };
  },
  createFromBuffer(buf: Buffer): NativeImage {
    return {
      isEmpty: () => !buf || buf.length < 8,
      addRepresentation: () => {},
    };
  },
};

export class ClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

export const clipboard = {
  async write(_items: any[]): Promise<void> {},
};

export const protocol = {
  registerSchemesAsPrivileged(_schemes: any[]): void {},
  handle(_scheme: string, _handler: (req: Request) => Response | Promise<Response>): void {},
};

export type MenuItemConstructorOptions = Record<string, any>;
export type Menu = Record<string, any>;

export const Menu = {
  buildFromTemplate(_template: MenuItemConstructorOptions[]): Menu {
    return {};
  },
  setApplicationMenu(_menu: Menu | null): void {},
};

export const contextBridge = {
  exposeInMainWorld(_apiKey: string, _api: any): void {},
};

export const ipcRenderer = {
  invoke(_channel: string, ..._args: any[]): Promise<any> {
    return Promise.resolve();
  },
  send(_channel: string, ..._args: any[]): void {},
  on(_channel: string, _listener: (...args: any[]) => void): void {},
  removeListener(_channel: string, _listener: (...args: any[]) => void): void {},
};

export const webUtils = {
  getPathForFile(_file: File): string {
    return "";
  },
};

declare global {
  namespace Electron {
    type IpcMainEvent = any;
    type IpcMainInvokeEvent = any;
    interface WebContents {
      setWindowOpenHandler: (fn: (details: { url: string }) => any) => void;
      on: (ev: string, fn: (event: any, ...args: any[]) => void) => void;
      [key: string]: any;
    }
    type Event = any;
    type Cookie = any;
  }
  namespace NodeJS {
    interface Process {
      resourcesPath: string;
      defaultApp?: boolean;
    }
  }
}

export class Tray extends EventEmitter {
  constructor(_icon: any) {
    super();
  }
  setToolTip(_t: string): void {}
  setContextMenu(_m: any): void {}
  isDestroyed(): boolean {
    return false;
  }
  destroy(): void {}
}

export class Notification extends EventEmitter {
  static isSupported(): boolean {
    return false;
  }
  constructor(_opts?: any) {
    super();
  }
  show(): void {}
}

export const powerMonitor = new EventEmitter();

export const screen = {
  getAllDisplays() {
    return [
      {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      },
    ];
  },
  getPrimaryDisplay() {
    return {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    };
  },
  getDisplayMatching(_rect: any) {
    return this.getPrimaryDisplay();
  },
  getCursorScreenPoint() {
    return { x: 500, y: 500 };
  },
};
