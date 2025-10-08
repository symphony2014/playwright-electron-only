/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import os from 'os';
import path from 'path';

import { ManualPromise } from '../../utils';
import { CRBrowser } from '../chromium/crBrowser';
import { CRConnection } from '../chromium/crConnection';
import { createHandle, CRExecutionContext } from '../chromium/crExecutionContext';
import { toConsoleMessageLocation } from '../chromium/crProtocolHelper';
import { ConsoleMessage } from '../console';
import { SdkObject } from '../instrumentation';
import * as js from '../javascript';

import type { BrowserContext } from '../browserContext';
import type { CRBrowserContext } from '../chromium/crBrowser';
import type { CRSession } from '../chromium/crConnection';
import type { CRPage } from '../chromium/crPage';
import type { Protocol } from '../chromium/protocol';
import type { Page } from '../page';
import type * as childProcess from 'child_process';
import type { BrowserWindow } from 'electron';


export class ElectronApplication extends SdkObject {
  static Events = {
    Close: 'close',
    Console: 'console',
  };

  private _browserContext: CRBrowserContext;
  private _nodeConnection: CRConnection;
  private _nodeSession: CRSession;
  private _nodeExecutionContext: js.ExecutionContext | undefined;
  _nodeElectronHandlePromise: ManualPromise<js.JSHandle<typeof import('electron')>> = new ManualPromise();
  private _process: childProcess.ChildProcess;

  constructor(parent: SdkObject, browser: CRBrowser, nodeConnection: CRConnection, process: childProcess.ChildProcess) {
    super(parent, 'electron-app');
    this._process = process;
    this._browserContext = browser._defaultContext as CRBrowserContext;
    this._nodeConnection = nodeConnection;
    this._nodeSession = nodeConnection.rootSession;
    this._nodeSession.on('Runtime.executionContextCreated', async (event: Protocol.Runtime.executionContextCreatedPayload) => {
      if (!event.context.auxData || !event.context.auxData.isDefault)
        return;
      const crExecutionContext = new CRExecutionContext(this._nodeSession, event.context);
      this._nodeExecutionContext = new js.ExecutionContext(this, crExecutionContext, 'electron');
      const { result: remoteObject } = await crExecutionContext._client.send('Runtime.evaluate', {
        expression: `require('electron')`,
        contextId: event.context.id,
        // Needed after Electron 28 to get access to require: https://github.com/microsoft/playwright/issues/28048
        includeCommandLineAPI: true,
      });
      this._nodeElectronHandlePromise.resolve(new js.JSHandle(this._nodeExecutionContext!, 'object', 'ElectronModule', remoteObject.objectId!));
    });
    this._nodeSession.on('Runtime.consoleAPICalled', event => this._onConsoleAPI(event));
    const appClosePromise = new Promise(f => this.once(ElectronApplication.Events.Close, f));
    this._browserContext.setCustomCloseHandler(async () => {
      await this._browserContext.stopVideoRecording();
      const electronHandle = await this._nodeElectronHandlePromise;
      await electronHandle.evaluate(({ app }) => app.quit()).catch(() => {});
      this._nodeConnection.close();
      await appClosePromise;
    });
  }

  async _onConsoleAPI(event: Protocol.Runtime.consoleAPICalledPayload) {
    if (event.executionContextId === 0) {
      // DevTools protocol stores the last 1000 console messages. These
      // messages are always reported even for removed execution contexts. In
      // this case, they are marked with executionContextId = 0 and are
      // reported upon enabling Runtime agent.
      //
      // Ignore these messages since:
      // - there's no execution context we can use to operate with message
      //   arguments
      // - these messages are reported before Playwright clients can subscribe
      //   to the 'console'
      //   page event.
      //
      // @see https://github.com/GoogleChrome/puppeteer/issues/3865
      return;
    }
    if (!this._nodeExecutionContext)
      return;
    const args = event.args.map(arg => createHandle(this._nodeExecutionContext!, arg));
    const message = new ConsoleMessage(null, event.type, undefined, args, toConsoleMessageLocation(event.stackTrace));
    this.emit(ElectronApplication.Events.Console, message);
  }

  async initialize() {
    await this._nodeSession.send('Runtime.enable', {});
    // Delay loading the app until browser is started and the browser targets are configured to auto-attach.
    await this._nodeSession.send('Runtime.evaluate', { expression: '__playwright_run()' });
  }

  process(): childProcess.ChildProcess {
    return this._process;
  }

  context(): BrowserContext {
    return this._browserContext;
  }

  async close() {
    // This will call BrowserContext.setCustomCloseHandler.
    await this._browserContext.close({ reason: 'Application exited' });
  }

  async browserWindow(page: Page): Promise<js.JSHandle<BrowserWindow>> {
    // Assume CRPage as Electron is always Chromium.
    const targetId = (page.delegate as CRPage)._targetId;
    const electronHandle = await this._nodeElectronHandlePromise;
    return await electronHandle.evaluateHandle(({ BrowserWindow, webContents }, targetId) => {
      const wc = webContents.fromDevToolsTargetId(targetId);
      return BrowserWindow.fromWebContents(wc!)!;
    }, targetId);
  }
}
