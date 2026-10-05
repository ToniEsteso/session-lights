import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { scaleFromPercent, scaleFromRegistry } from '../src/system-text.js';
import { clean } from '../src/preferences.js';
import { parseAction } from '../src/shared/validation.js';

test('Windows text size parses its supported range and defaults for unavailable settings', () => {
  for (const percent of [100, 125, 150, 200, 225]) assert.equal(scaleFromPercent(percent), percent / 100);
  for (const value of [null, undefined, '125', 99, 226, NaN, Infinity, 125.5]) assert.equal(scaleFromPercent(value), 1);
  assert.equal(scaleFromRegistry('HKEY_CURRENT_USER\\Software\\Microsoft\\Accessibility\r\n    TextScaleFactor    REG_DWORD    0x7d\r\n'), 1.25);
  assert.equal(scaleFromRegistry('    TextScaleFactor    REG_DWORD    150\n'), 1.5);
  assert.equal(scaleFromRegistry('    TextScaleFactor    REG_SZ    150\n'), 1);
  assert.equal(scaleFromRegistry('ERROR: Missing value'), 1);
});

test('manual text preferences and commands cannot override system text settings', () => {
  assert.equal('textSize' in clean({ textSize: 'large' }), false);
  assert.equal(parseAction({ type: 'text-size', size: 'large' }), undefined);
});
