import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAdminSecret } from "../../lib/adminSecret";
import { formatDate } from "../../lib/format";

export default function AdminScrapeHealthPage() {
  const { secret, setSecret } = useAdminSecret();
  const [secretInput, setSecretInput] = useState(secret);
  const [heatNoInput, setHeatNoInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const scrapingEnabled = useQuery(api.appSettings.get, { key: "scrapingEnabled" });
  const backfillCursor = useQuery(api.appSettings.get, { key: "backfillCursor" });
  const errors = useQuery(api.heats.listRecentErrors, { limit: 25 });

  const setSetting = useMutation(api.appSettings.set);
  const adminScrapeHeat = useAction(api.actions.scrapeHeats.adminScrapeHeat);
  const adminRunBatchNow = useAction(api.actions.scrapeHeats.adminRunBatchNow);

  const toggleScraping = async () => {
    setBusy(true);
    setMessage("");
    try {
      await setSetting({ key: "scrapingEnabled", value: !(scrapingEnabled ?? true), adminSecret: secret });
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };

  const runScrapeHeat = async () => {
    const n = parseInt(heatNoInput, 10);
    if (!Number.isFinite(n)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await adminScrapeHeat({ heatNo: n, adminSecret: secret });
      setMessage(`Heat #${n}: ${result}`);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };

  const runBatchNow = async () => {
    setBusy(true);
    setMessage("");
    try {
      await adminRunBatchNow({ adminSecret: secret });
      setMessage("Batch kicked off.");
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Scrape Health</h1>

      <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <label className="block text-sm font-medium mb-1">Admin secret</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Enter admin secret"
          />
          <button
            onClick={() => setSecret(secretInput)}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Scraping</div>
          <div className="mt-1 flex items-center justify-between">
            <span className="font-semibold">{scrapingEnabled === false ? "Paused" : "Running"}</span>
            <button
              onClick={toggleScraping}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {scrapingEnabled === false ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Backfill cursor</div>
          <div className="mt-1 font-semibold tabular-nums">
            {typeof backfillCursor === "number" ? `Heat #${backfillCursor}` : "Not started"}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800 space-y-3">
        <div className="flex gap-2">
          <input
            type="number"
            value={heatNoInput}
            onChange={(e) => setHeatNoInput(e.target.value)}
            placeholder="Heat number"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={runScrapeHeat}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Scrape heat now
          </button>
          <button
            onClick={runBatchNow}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Run one batch now
          </button>
        </div>
        {message && <p className="text-sm text-neutral-500">{message}</p>}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent scrape errors</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Heat</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {errors?.map((e) => (
                <tr key={e._id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">#{e.heatNo}</td>
                  <td className="px-3 py-2">{e.stage}</td>
                  <td className="px-3 py-2">{e.errorMessage}</td>
                  <td className="px-3 py-2">{formatDate(e.attemptedAt)}</td>
                </tr>
              ))}
              {errors?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">
                    No errors logged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
