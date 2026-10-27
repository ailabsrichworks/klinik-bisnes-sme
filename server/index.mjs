import { config, googleReady, missingConfig } from './config.mjs';
import { Store, googleClients } from './store.mjs';
import { createFakeGoogle } from './google-fake.mjs';
import { createApp } from './app.mjs';

const missing = missingConfig();
if (missing.length) console.warn(`[config] missing: ${missing.join(', ')}`);

// Without Google credentials the app still runs, on an in-memory sheet: fine for trying it out,
// but everything is lost on restart.
let clients;
if (googleReady()) {
  clients = await googleClients(config.googleServiceAccount);
} else {
  console.warn('[store] Google not configured — using an IN-MEMORY sheet. Data is lost on restart.');
  clients = createFakeGoogle();
}
const store = new Store({ ...clients, sheetId: config.sheetId || 'memory', folderId: config.driveFolderId || 'memory' });
try {
  await store.init();
} catch (err) {
  const code = err?.code || err?.status;
  console.error(`[store] could not open the Google Sheet (${code}): ${err?.message}`);
  if (code === 403 || code === 404) console.error('[store] Check SHEET_ID and that the sheet is shared with the service account as Editor.');
  process.exit(1);
}

const server = createApp({ store }).listen(config.port, () => console.log(`KBSME Quick Fix listening on :${config.port}`));

// Railway sends SIGTERM on deploy: write pending changes before exiting.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    server.close();
    try { await store.stop(); } catch (err) { console.error('[store] final flush failed', err?.message); }
    process.exit(0);
  });
}
