
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright-core';
import * as path from 'path';

test('ElectronApplication can be launched', async () => {
  const electronApp = await electron.launch({ args: [path.join(__dirname, 'electron-app.js')] });
  // TODO: The ElectronApplication class is not exported from the package.
  // We should probably export it to be able to instance check.
  // For now, we just check if the app is truthy.
  expect(electronApp).toBeTruthy();
  await electronApp.close();
});
