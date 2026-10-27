// In-process stand-in for the Google Sheets and Drive APIs (only the calls store.mjs makes).
// Used by the tests, and by the server when no Google credentials are set (data is then lost on restart).
import { randomUUID } from 'node:crypto';

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// "'Log AI'!A2:G" → { tab, c0, r0, c1, r1 } (0-based, open ends = Infinity)
function parseRange(range) {
  const m = /^'?(.+?)'?!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/.exec(range);
  if (!m) throw new Error(`fake: bad range ${range}`);
  const [, tab, ca, ra, cb, rb] = m;
  return {
    tab,
    c0: ca ? colIndex(ca) : 0,
    r0: ra ? Number(ra) - 1 : 0,
    c1: cb ? colIndex(cb) : (m[4] === undefined ? (ca ? colIndex(ca) : Infinity) : Infinity),
    r1: rb ? Number(rb) - 1 : (m[4] === undefined && ra ? Number(ra) - 1 : Infinity),
  };
}

function apiError(code) {
  const e = new Error(`fake ${code}`);
  e.code = code; e.status = code;
  return e;
}

export function createFakeGoogle() {
  const tabs = new Map(); // title → { id, rows: string[][] }
  const files = new Map(); // id → { name, parents, mimeType, bytes }
  const calls = [];
  const failures = [];
  let nextSheetId = 1;

  const maybeFail = (name) => {
    const i = failures.findIndex((f) => f.name === name);
    if (i >= 0) { const [f] = failures.splice(i, 1); throw apiError(f.code); }
  };
  const tab = (title) => {
    const t = tabs.get(title);
    if (!t) throw apiError(400);
    return t;
  };
  const write = (t, r, c, values) => {
    values.forEach((row, i) => {
      t.rows[r + i] ||= [];
      row.forEach((v, j) => { t.rows[r + i][c + j] = v == null ? '' : String(v); });
    });
  };
  const lastRow = (t) => {
    for (let i = t.rows.length - 1; i >= 0; i--) if ((t.rows[i] || []).some((v) => v !== '' && v != null)) return i;
    return -1;
  };

  const sheets = {
    spreadsheets: {
      async get() {
        calls.push('get');
        maybeFail('get');
        return { data: { sheets: [...tabs].map(([title, t]) => ({ properties: { sheetId: t.id, title } })) } };
      },
      async batchUpdate({ requestBody }) {
        calls.push('batchUpdate');
        maybeFail('batchUpdate');
        const replies = requestBody.requests.map((rq) => {
          if (rq.addSheet) {
            const title = rq.addSheet.properties.title;
            const t = { id: nextSheetId++, rows: [] };
            tabs.set(title, t);
            return { addSheet: { properties: { sheetId: t.id, title } } };
          }
          return {};
        });
        return { data: { replies } };
      },
      values: {
        async get({ range }) {
          calls.push('values.get');
          maybeFail('values.get');
          const { tab: title, c0, r0, c1, r1 } = parseRange(range);
          const t = tab(title);
          const out = [];
          for (let r = r0; r <= Math.min(r1, t.rows.length - 1); r++) {
            const row = (t.rows[r] || []).slice(c0, c1 === Infinity ? undefined : c1 + 1);
            while (row.length && (row.at(-1) === '' || row.at(-1) == null)) row.pop();
            out.push(row.map((v) => v ?? ''));
          }
          while (out.length && !out.at(-1).length) out.pop();
          return { data: out.length ? { values: out } : {} };
        },
        async batchUpdate({ requestBody }) {
          calls.push(`values.batchUpdate:${requestBody.valueInputOption}`);
          maybeFail('values.batchUpdate');
          for (const { range, values } of requestBody.data) {
            const { tab: title, c0, r0 } = parseRange(range);
            write(tab(title), r0, c0, values);
          }
          return { data: {} };
        },
        async append({ range, valueInputOption, requestBody }) {
          calls.push(`values.append:${valueInputOption}`);
          maybeFail('values.append');
          const t = tab(parseRange(range).tab);
          const start = lastRow(t) + 1;
          write(t, start, 0, requestBody.values);
          return { data: { updates: { updatedRange: `'${range.split('!')[0]}'!A${start + 1}` } } };
        },
      },
    },
  };

  const drive = {
    files: {
      async create({ requestBody, media }) {
        calls.push('drive.create');
        maybeFail('drive.create');
        const chunks = [];
        for await (const c of media.body) chunks.push(Buffer.from(c));
        const id = randomUUID();
        files.set(id, { name: requestBody.name, parents: requestBody.parents, mimeType: media.mimeType, bytes: Buffer.concat(chunks) });
        return { data: { id, webViewLink: `https://drive.example/${id}` } };
      },
      async get({ fileId }) {
        calls.push('drive.get');
        maybeFail('drive.get');
        const f = files.get(fileId);
        if (!f) throw apiError(404);
        return { data: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.length) };
      },
      async delete({ fileId }) {
        calls.push('drive.delete');
        maybeFail('drive.delete');
        if (!files.delete(fileId)) throw apiError(404);
        return { data: {} };
      },
    },
  };

  return {
    sheets, drive, calls, files,
    rows: (title) => tabs.get(title)?.rows ?? [],
    // Make the next call with this name fail with an HTTP code (e.g. 429).
    failNext: (name, code = 429) => failures.push({ name, code }),
    // Simulate a trainer sorting or moving rows by hand.
    swapRows: (title, a, b) => { const t = tab(title); [t.rows[a], t.rows[b]] = [t.rows[b], t.rows[a]]; },
    setCell: (title, r, c, v) => write(tab(title), r, c, [[v]]),
  };
}
