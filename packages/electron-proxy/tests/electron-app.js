
const { app, BrowserWindow } = require('electron');

app.on('ready', () => {
  const win = new BrowserWindow();
  win.loadURL('about:blank');
});
