// Talks to the Apps Script web app pasted into the Sheet (apps-script/Code.gs) instead of the
// Google APIs, so no Google Cloud project or service account is needed. Exposes the same small
// slice of the `googleapis` sheets/drive clients that store.mjs uses.

export function appsScriptClients({ url, secret, fetchImpl = fetch, timeoutMs = 60_000 }) {
  const titles = new Map(); // sheetId → tab title, for the formatting requests

  async function rpc(op, args = {}) {
    let res;
    try {
      // text/plain: Apps Script reads the raw body; it follows a redirect to the result.
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret, op, ...args }),
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw Object.assign(new Error(`Apps Script unreachable: ${e.message}`), { code: 503 });
    }
    const text = await res.text();
    let out;
    try { out = JSON.parse(text); } catch {
      // A login page or an error page instead of JSON: usually the deployment isn't "Anyone".
      const code = res.status === 429 || res.status >= 500 ? res.status : 502;
      throw Object.assign(new Error(`Apps Script returned HTTP ${res.status}, not JSON. Check the Web app URL and that access is "Anyone".`), { code });
    }
    if (!out.ok) throw Object.assign(new Error(`Apps Script: ${out.error}`), { code: out.code || 500 });
    return out.result;
  }

  const remember = (list) => { list.forEach((t) => titles.set(t.sheetId, t.title)); return list; };
  const tabOf = (range) => titles.get(range.sheetId);

  const sheets = {
    spreadsheets: {
      async get() {
        return { data: { sheets: remember(await rpc('tabs')).map((t) => ({ properties: t })) } };
      },
      async batchUpdate({ requestBody }) {
        const adds = [], items = [];
        for (const r of requestBody.requests) {
          if (r.addSheet) adds.push({ title: r.addSheet.properties.title, frozen: r.addSheet.properties.gridProperties?.frozenRowCount || 0 });
          else if (r.addProtectedRange) items.push({ kind: 'protectHeader', tab: tabOf(r.addProtectedRange.protectedRange.range) });
          else if (r.repeatCell) items.push({ kind: 'boldHeader', tab: tabOf(r.repeatCell.range) });
          else if (r.updateDimensionProperties) items.push({ kind: 'hideColumn', tab: tabOf(r.updateDimensionProperties.range), col: r.updateDimensionProperties.range.startIndex });
        }
        const replies = [];
        if (adds.length) {
          const list = remember(await rpc('addTabs', { tabs: adds }));
          for (const a of adds) replies.push({ addSheet: { properties: list.find((t) => t.title === a.title) } });
        }
        if (items.length) await rpc('format', { items });
        return { data: { replies } };
      },
      values: {
        async get({ range }) {
          const values = await rpc('read', { range });
          return { data: values.length ? { values } : {} };
        },
        async batchUpdate({ requestBody }) {
          await rpc('write', { data: requestBody.data });
          return { data: {} };
        },
        async append({ range, requestBody }) {
          await rpc('append', { tab: range.split('!')[0].replace(/^'|'$/g, ''), values: requestBody.values });
          return { data: {} };
        },
      },
    },
  };

  const drive = {
    files: {
      async create({ requestBody, media }) {
        const chunks = [];
        for await (const c of media.body) chunks.push(Buffer.from(c));
        const data = await rpc('fileCreate', { name: requestBody.name, mime: media.mimeType, base64: Buffer.concat(chunks).toString('base64') });
        return { data };
      },
      async get({ fileId }) {
        const b = Buffer.from(await rpc('fileGet', { id: fileId }), 'base64');
        return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
      },
      async delete({ fileId }) {
        await rpc('fileDelete', { id: fileId });
        return { data: {} };
      },
    },
  };

  return { sheets, drive, ping: () => rpc('tabs') };
}
