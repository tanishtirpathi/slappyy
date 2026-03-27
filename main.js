import { app, Tray, Menu, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import Store from "electron-store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const store = new Store();

let tray = null;
let win = null;
let isQuitting = false;

// ─── Sound ────────────────────────────────────────────────────────────────────
function playSound() {
  const file = path.join(__dirname, "slap.wav");
  if (!existsSync(file)) {
    console.error("Sound file not found:", file);
    return;
  }
  execFile("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]"${file}"); $p.Play(); Start-Sleep -Milliseconds 3000; $p.Stop();`
  ], (err) => { if (err) console.error("Sound error:", err); });
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 300,
    height: 350,
    x: width - 320,
    y: height - 380,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile("index.html");

  win.once("ready-to-show", () => win.show());

  // Clicking outside the window hides it (optional — remove if you want it sticky)
  win.on("blur", () => {
    if (!isQuitting) win.hide();
  });

  win.on("closed", () => { win = null; });
}

function toggleWindow() {
  if (!win) { createWindow(); return; }
  if (win.isVisible()) win.hide();
  else {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    win.setPosition(width - 320, height - 380);
    win.show();
    win.focus();
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.on("impact-detected", () => playSound());

ipcMain.handle("get-sensitivity", () => {
  const raw = Number(store.get("sensitivityMultiplier", 4));
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(10, raw));
});

ipcMain.on("set-sensitivity", (_, value) => {
  const numeric = Number(value);
  const next = Number.isFinite(numeric) ? Math.max(1, Math.min(10, numeric)) : 4;
  store.set("sensitivityMultiplier", next);
});

ipcMain.on("close-window", () => win?.hide());

ipcMain.on("start-listening", () => win?.webContents.send("start"));
ipcMain.on("stop-listening",  () => win?.webContents.send("stop"));

// ─── App ──────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  tray = new Tray(path.join(__dirname, "icon.png"));
  tray.setToolTip("Impact Detector");

  tray.on("click", toggleWindow);

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show / Hide",    click: toggleWindow },
    { label: "Start Listening", click: () => win?.webContents.send("start") },
    { label: "Stop Listening",  click: () => win?.webContents.send("stop") },
    { type: "separator" },
    { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
  ]));

  app.setLoginItemSettings({ openAtLogin: true });
});

app.on("before-quit", () => {
  isQuitting = true;
  win?.webContents.send("stop");
});

app.on("window-all-closed", (e) => {
  if (!isQuitting) e.preventDefault();
});