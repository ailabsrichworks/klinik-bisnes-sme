// Saves each participant's report PDF to Drive once they reach the report (the last step), and
// replaces it when their answers there change (calculator, workshop, 7-day plan). Waits for a pause in
// changes so a busy participant makes one file, not one per keystroke.
import { createHash } from 'node:crypto';
import { reportPdf } from './report-pdf.mjs';
import { pillarAnswers } from './store.mjs';

export const sessionNameOf = (store, j) => (j.sessionCode ? store.sessionByCode(j.sessionCode)?.name || j.sessionCode : '');

export function reportSaver(store, { delayMs = Number(process.env.REPORT_DELAY_MS || 15_000) } = {}) {
  const timers = new Map();

  async function save(id) {
    timers.delete(id);
    const j = store.journeys.get(id);
    if (!j || pillarAnswers(j.state).selected.length !== 3) return null;
    const sessionName = sessionNameOf(store, j);
    const { evidenceText, ...content } = j.state; // evidence is not part of the report
    const hash = createHash('sha256').update(JSON.stringify([content, sessionName])).digest('hex').slice(0, 16);
    if (j.report?.hash === hash) return j.report; // nothing changed since the last copy
    const bytes = await reportPdf({ state: j.state, sessionName });
    return store.saveReport(j, bytes, hash);
  }

  return {
    // Called when a participant at Langkah 5 saves.
    schedule(j) {
      clearTimeout(timers.get(j.id));
      const t = setTimeout(() => save(j.id).catch((err) => console.error('[report] save failed', j.id, err?.message)), delayMs);
      t.unref?.();
      timers.set(j.id, t);
    },
    // On shutdown: save everything still waiting.
    async flushAll() {
      const ids = [...timers.keys()];
      ids.forEach((id) => clearTimeout(timers.get(id)));
      await Promise.allSettled(ids.map(save));
    },
    save,
  };
}
