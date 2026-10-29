const { app, BrowserWindow, dialog, Menu, safeStorage, session, utilityProcess, shell } = require('electron');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const { loadConfiguration, importConfiguration } = require('./config.cjs');
const { importReceipts } = require('./import-receipts.cjs');

const PORT = 43187;
const ORIGIN = `http://127.0.0.1:${PORT}`;
app.setName('Yogurt Manager');
// An explicit separate profile is useful for private verification without touching the owner's data.
const profile = process.argv.find(value => value.startsWith('--yogurt-profile='))?.slice('--yogurt-profile='.length);
if (profile && path.isAbsolute(profile)) app.setPath('userData', profile);
const ownInstance = app.requestSingleInstanceLock();
let mainWindow;
let child;
let childExited;
let heartbeat;
let shuttingDown;
let finished = false;
let startup = true;
let allowLocalTestDatabase = false;
const capability = randomBytes(48).toString('base64url');

function exactOrigin(url) {
  try { return new URL(url).origin === ORIGIN; } catch { return false; }
}

async function shutdown() {
  if (shuttingDown) return shuttingDown;
  shuttingDown = (async () => {
    clearInterval(heartbeat);
    if (child) {
      child.postMessage({ type: 'shutdown' });
      let timer;
      await Promise.race([childExited, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
      clearTimeout(timer);
      child?.kill();
      child = undefined;
    }
    finished = true;
    app.quit();
  })();
  return shuttingDown;
}

async function chooseSettings(directory, suppliedPath) {
  let envPath = suppliedPath;
  if (!envPath) {
    const chosen = await dialog.showOpenDialog({
      title: 'ເລືອກໄຟລ໌ຕັ້ງຄ່າ Supabase (.env)',
      properties: ['openFile', 'showHiddenFiles'],
      buttonLabel: 'ນຳເຂົ້າ',
    });
    if (chosen.canceled) return null;
    envPath = chosen.filePaths[0];
  }
  // Import existing files only when they belong to the selected local configuration directory.
  const dataDirectory = path.join(directory, 'runtime');
  const configDirectory = path.dirname(envPath);
  const projectDirectory = path.basename(configDirectory) === '.yogurt' ? path.dirname(configDirectory) : configDirectory;
  for (const sourceDirectory of [
    path.join(projectDirectory, '.yogurt', 'private-receipts'),
    path.join(projectDirectory, 'public', 'uploads', 'receipts'),
  ]) {
    try { await fs.access(sourceDirectory); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await importReceipts({ sourceDirectory, directory: dataDirectory });
  }
  // Publish settings last: an interrupted file import must be retried on the next first launch.
  return importConfiguration({ safeStorage, directory, envPath, allowLocalTestDatabase });
}

async function configuration(directory) {
  const imported = process.argv.find(value => value.startsWith('--import-settings='))?.slice('--import-settings='.length);
  if (imported && path.isAbsolute(imported)) return chooseSettings(directory, imported);
  const existing = await loadConfiguration({ safeStorage, directory, allowLocalTestDatabase });
  if (existing) return existing;
  const result = await dialog.showMessageBox({
    type: 'info', title: 'Yogurt Manager',
    message: 'ຕັ້ງຄ່າ Supabase ສຳລັບ Mac ເຄື່ອງນີ້',
    detail: 'ເລືອກໄຟລ໌ .env ເດີມ. ລະບົບຈະເກັບການເຊື່ອມຕໍ່ແບບເຂົ້າລະຫັດ ແລະໃຊ້ຂໍ້ມູນໃນ Supabase ເດີມ.',
    buttons: ['ເລືອກໄຟລ໌ຕັ້ງຄ່າ', 'ຍົກເລີກ'], defaultId: 0, cancelId: 1,
  });
  return result.response === 0 ? chooseSettings(directory) : null;
}

function childEnvironment({ databaseUrl, sessionSecret }, directory, applicationRoot) {
  // Do not inherit NODE_OPTIONS, database variables, proxy flags or arbitrary development settings.
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: app.getPath('home'),
    TMPDIR: app.getPath('temp'),
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    PORT: `${PORT}`, HOSTNAME: '127.0.0.1', INTERNAL_APP_ORIGIN: ORIGIN,
    YOGURT_DATA_ROOT: path.join(directory, 'runtime'),
    YOGURT_APP_ROOT: applicationRoot,
    YOGURT_DESKTOP_TOKEN: capability,
    YOGURT_PARENT_PID: `${process.pid}`,
  };
}

function startBackend(settings, directory) {
  const applicationRoot = app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.resolve(__dirname, '..', 'build', 'desktop', 'backend');
  return new Promise((resolve, reject) => {
    child = utilityProcess.fork(path.join(__dirname, 'backend.cjs'), [], {
      cwd: applicationRoot, env: childEnvironment(settings, directory, applicationRoot),
      stdio: 'ignore', serviceName: 'Yogurt backend',
    });
    let exitResolve;
    childExited = new Promise(done => { exitResolve = done; });
    const timeout = setTimeout(() => reject(new Error('START_TIMEOUT')), 60_000);
    child.on('exit', () => {
      clearTimeout(timeout);
      exitResolve();
      child = undefined;
      reject(new Error('BACKEND_EXIT'));
      if (!startup && !shuttingDown) {
        dialog.showErrorBox('Yogurt Manager', 'ສ່ວນປະມວນຜົນຢຸດເຮັດວຽກ. ກະລຸນາເປີດແອັບໃໝ່; ກວດຜົນລາຍການຄ້າງກ່ອນສົ່ງຊ້ຳ.');
        mainWindow?.destroy();
        void shutdown();
      }
    });
    child.on('message', message => {
      if (message?.type === 'ready') { clearTimeout(timeout); resolve(); }
      if (message?.type === 'failed') { clearTimeout(timeout); reject(new Error(message.code)); }
    });
    heartbeat = setInterval(() => child?.postMessage({ type: 'heartbeat' }), 2000);
    heartbeat.unref();
  });
}

function createWindow() {
  const browserSession = session.fromPartition('persist:yogurt-manager');
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'x-yogurt-desktop-token') delete headers[name];
    if (exactOrigin(details.url)) headers['x-yogurt-desktop-token'] = capability;
    callback({ requestHeaders: headers });
  });
  browserSession.on('will-download', (event, item) => {
    if (!exactOrigin(item.getURL())) { event.preventDefault(); return; }
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  mainWindow = new BrowserWindow({
    title: 'Yogurt Manager', width: 1320, height: 900, minWidth: 960, minHeight: 680,
    backgroundColor: '#F8F6EF', show: false,
    webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!exactOrigin(url)) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (exactOrigin(url) && /^\/(?:api\/receipts|uploads\/receipts)\//.test(new URL(url).pathname)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        title: 'Yogurt Manager — ໃບເສັດ', parent: mainWindow, width: 1000, height: 800,
        webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
      } };
    }
    if (exactOrigin(url)) { void mainWindow?.loadURL(url); }
    else if (/^https:\/\/(?:www\.)?google\.com\/maps(?:[/?]|$)/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', preview => {
    preview.webContents.on('will-navigate', (event, url) => { if (!exactOrigin(url)) event.preventDefault(); });
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', title: 'Yogurt Manager',
      message: 'ມີຂໍ້ມູນທີ່ຍັງບໍ່ໄດ້ບັນທຶກ', detail: 'ກັບໄປບັນທຶກກ່ອນປິດ ຫຼືຢືນຢັນປິດແອັບ.',
      buttons: ['ກັບໄປບັນທຶກ', 'ປິດແອັບ'], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', () => { mainWindow?.destroy(); void shutdown(); });
  mainWindow.on('closed', () => { mainWindow = undefined; void shutdown(); });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  void mainWindow.loadURL(ORIGIN);
}

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.on('window-all-closed', () => void shutdown());
app.on('before-quit', event => {
  if (finished) return;
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  else void shutdown();
});

if (!ownInstance) app.exit(0);
else app.whenReady().then(async () => {
  const directory = app.getPath('userData');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.argv.includes('--yogurt-test') && profile) {
    const relative = path.relative(await fs.realpath(app.getPath('temp')), await fs.realpath(directory));
    allowLocalTestDatabase = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }
  const settings = await configuration(directory);
  if (!settings) { await shutdown(); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Yogurt Manager', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'ເບິ່ງ', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  await startBackend(settings, directory);
  startup = false;
  createWindow();
}).catch(async error => {
  const busy = error?.message === 'PORT_BUSY';
  dialog.showErrorBox('Yogurt Manager', busy
    ? 'ພອດ 43187 ຖືກໃຊ້ໂດຍໂປຣແກຣມອື່ນ. ປິດໂປຣແກຣມນັ້ນແລ້ວເປີດແອັບໃໝ່.'
    : 'ເປີດແອັບບໍ່ສຳເລັດ. ກວດໄຟລ໌ຕັ້ງຄ່າ ແລະສິດ Keychain ແລ້ວເປີດແອັບໃໝ່.');
  await shutdown();
});
