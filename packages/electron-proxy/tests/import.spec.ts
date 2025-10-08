
import { test, expect } from '@playwright/test';
import * as electronProxy from '..';

test('can be imported', () => {
  expect(electronProxy).toBeTruthy();
});
