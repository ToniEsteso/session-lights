import { CodexUsage } from '../src/adapters/codex-usage.js';
async function main() {
  const reader = new CodexUsage();
  try {
    const result = await reader.read();
    console.log(JSON.stringify(result, null, 2));
    if (result.windows.length !== 2) process.exitCode = 1;
  } finally { reader.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
