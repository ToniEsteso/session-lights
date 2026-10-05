// Outside Electron, its npm package exports the executable path instead of its API.
export function electronBinary(): string {
  const value: unknown = require('electron');
  if (typeof value !== 'string') throw Error('Run this command with Node.js.');
  return value;
}
