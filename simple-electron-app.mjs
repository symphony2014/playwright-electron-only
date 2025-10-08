import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { ElectronApplication } from './packages/electron-proxy/lib/server/electron/electron.js';
import {Playwright} from './packages/electron-proxy/lib/server/playwright.js';
// proxyBrowser.ts

// Note: You might need to adjust the path to these imports based on your project structure.
// They are assumed to be available from 'playwright-core' as in your original code.
//const { ElectronApplication } = require('playwright-core/lib/server/electron');

// Assuming you're in an environment where 'electron' types are available


/**
 * Custom transport for Playwright's Connection to route messages
 * through Electron's Debugger API.
 */


export class ProxyBrowser {
    // Private properties
      _proxyWindow;
      _dbg;
     _electronApp = null;
     _transport = null;

    /**
     * Initializes the ProxyBrowser with an existing Electron BrowserWindow.
     * @param proxyWindow The existing Electron BrowserWindow instance.
     */
    constructor(proxyWindow) {
        this._proxyWindow = proxyWindow;
        this._dbg = proxyWindow.webContents.debugger;
        
        // Ensure to handle the detach event if the debugger is detached externally
        this._dbg.on('detach', (event, reason) => {
            console.log(`Debugger detached due to: ${reason}`);
            this._transport?._onclose(); // Notify Playwright connection to close
        });
    }

    /**
     * Public method to connect Playwright to the existing Electron window.
     * Must be called before any other Playwright operations.
     */
     async connect(){
        if (this._electronApp) {
            console.warn("Playwright is already connected.");
            return this._electronApp;
        }

        // 1. Attach the debugger to enable CDP communication
        if (!this._dbg.isAttached()) {
            this._dbg.attach('1.3');
        }

        // 2. Create and wire up the custom transport for Playwright
        this._transport = this._createTransport();
        this._dbg.on('message', (event, method, params, sessionId) => this._transport.onEvent(event, method, params, sessionId));

        // 3. Create a Playwright Core Connection
        const connection = new Connection(this._transport);

        // 4. Create a Playwright object that is bound to the connection
        const playwright = new Playwright('chromium', connection);

        // 5. Manually create an ElectronApplication object
        // This links the Playwright environment to the Electron window.
        // The ElectronApplication import is only a type. You need to use the correct constructor from playwright-core.
        // Since we can't directly use ElectronApplication as a value, we'll use the playwright object's electron property.
        this._electronApp = new ElectronApplication(playwright, this._proxyWindow);

        // The windows should now be available
        return this._electronApp;
    }

    /**
     * Public method to detach the debugger and clean up the connection.
     */
     async disconnect() {
        if (this._electronApp) {
            await this._electronApp.close();
        }
        if (this._dbg.isAttached()) {
            this._dbg.detach();
        }
        this._transport = null;
    }

    /**
     * Public method to test the connection by navigating to Google.
     */
     async test() {
        const page = (await this._electronApp.firstWindow()) ;
        await page?.goto('https://www.google.com');
        await page?.close();
    }

    /**
     * Public method to start real-time audio playback in the browser window.
     * This will unmute the window's web contents.
     */
    async startRealtimeAudio() {
        this._proxyWindow.webContents.setAudioMuted(false);
        console.log("Real-time audio started (unmuted).");
    }

    /**
     * Public method to stop real-time audio playback in the browser window.
     * This will mute the window's web contents.
     */
    async stopRealtimeAudio() {
        this._proxyWindow.webContents.setAudioMuted(true);
        console.log("Real-time audio stopped (muted).");
    }

    /**
     * Private helper to create the custom transport object for Playwright.
     * @returns The custom transport object.
     */
    _createTransport() {    
        const transport = {
            _onmessage: () => {},
            _onclose: () => {},

            // Playwright sends a JSON message string here
            send: (message) => {
                const parsedMessage = JSON.parse(message);

                if (parsedMessage.id) {
                    // CDP Command (e.g., Runtime.evaluate)
                    this._dbg.sendCommand(parsedMessage.method, parsedMessage.params)
                        .then(result => {
                            // Forward the result back to Playwright
                            const response = JSON.stringify({
                                id: parsedMessage.id,
                                result: result
                            });
                            transport._onmessage(response);
                        })
                        .catch(error => {
                            // Forward errors back to Playwright
                            const response = JSON.stringify({
                                id: parsedMessage.id,
                                error: { message: error.message }
                            });
                            transport._onmessage(response);
                        });
                }
            },

            // Playwright registers its message handler here
            onmessage: (handler) => {
                transport._onmessage = handler;
            },

            // Electron's debugger sends asynchronous events (no 'id') here
            onEvent: (event, method, params, sessionId) => {
                const message = JSON.stringify({
                    method: event,
                    params: params
                });
                transport._onmessage(message);
            },

            // Playwright registers its close handler here
            onclose: (handler) => {
                transport._onclose = handler;
            },

            // Called when Playwright decides to close the connection
            close: () => {
                // Detach when Playwright decides to close the connection
                if (this._dbg.isAttached()) this._dbg.detach();
            }
        };

        return transport;
    }
}

// ---------------------------------------------------------------------

// --- Example Usage (Assuming this is back in your main Electron file) ---
/*
// 1. You need to import the class
// const { ProxyBrowser } = require('./proxyBrowser'); // For JS
// import { ProxyBrowser } from './proxyBrowser'; // For TS

// 2. Assuming 'proxyWindow' is your existing BrowserWindow instance
// const proxyWindow: BrowserWindow = ...;

async function automateExistingWindow() {
    console.log("Connecting Playwright to existing Electron window via ProxyBrowser...");
    
    const browser = new ProxyBrowser(proxyWindow);
    const electronApp = await browser.connect(); // Connects and attaches the debugger

    // Public audio controls are available
    browser.startRealtimeAudio();
    
    // Now you can use the Playwright API directly!
    const page = electronApp.windows()[0] as Page;

    await page.goto('https://playwright.dev');
    console.log(`Page title: ${await page.title()}`);
    
    // Simulate a brief wait
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Stop the audio
    browser.stopRealtimeAudio();

    // Clean up
    await browser.disconnect();
}

// Ensure the proxyWindow is created before calling automateExistingWindow()
// automateExistingWindow();
*/


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import('electron-squirrel-startup').then(squirrelStartup => {
  if (squirrelStartup) {
    app.quit();
  }
});

const createWindow = async () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    width: 800
  });

  // and load the index.html of the app.
  mainWindow.loadFile('index.html');


  const proxyBrowser = new ProxyBrowser(mainWindow);
  await proxyBrowser.connect();
  await proxyBrowser.test();
  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  await createWindow();

  // Create a simple menu
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'New', click: () => console.log('New file') },
      { label: 'Open', click: () => console.log('Open file') },
      { type: 'separator' },
      { label: 'Exit', click: () => app.quit() }
    ]},
    { label: 'Help', submenu: [
      { label: 'About', click: () => console.log('About clicked') }
    ]}
  ]);
  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.