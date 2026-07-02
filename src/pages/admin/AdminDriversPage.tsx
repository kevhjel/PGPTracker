import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAdminSecret } from "../../lib/adminSecret";

export default function AdminDriversPage() {
  const { secret } = useAdminSecret();
  const [searchText, setSearchText] = useState("");
  const [mergeSource, setMergeSource] = useState<{ id: Id<"drivers">; name: string } | null>(null);
  const [mergeTarget, setMergeTarget] = useState<{ id: Id<"drivers">; name: string } | null>(null);
  const [message, setMessage] = useState("");

  const results = useQuery(api.drivers.search, { text: searchText });
  const setWatched = useMutation(api.drivers.setWatched);
  const updateDisplayName = useMutation(api.drivers.updateDisplayName);
  const mergeDrivers = useMutation(api.drivers.mergeDrivers);

  const doMerge = async () => {
    if (!mergeSource || !mergeTarget) return;
    setMessage("");
    try {
      await mergeDrivers({
        sourceDriverId: mergeSource.id,
        targetDriverId: mergeTarget.id,
        adminSecret: secret,
      });
      setMessage(`Merged ${mergeSource.name} into ${mergeTarget.name}.`);
      setMergeSource(null);
      setMergeTarget(null);
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Manage Drivers</h1>

      <input
        type="text"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Search by name or CustID…"
        className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      />

      <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800 space-y-2">
        <div className="text-sm font-medium">Merge driver records</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Source: {mergeSource?.name ?? "(select below)"}</span>
          <span className="text-neutral-500">→</span>
          <span>Target: {mergeTarget?.name ?? "(select below)"}</span>
          <button
            onClick={doMerge}
            disabled={!mergeSource || !mergeTarget}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Merge source into target
          </button>
        </div>
        {message && <p className="text-neutral-500">{message}</p>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">CustID</th>
              <th className="px-3 py-2">Heats</th>
              <th className="px-3 py-2">Watched</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results?.map((driver) => (
              <tr key={driver._id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-3 py-2">
                  <input
                    defaultValue={driver.displayName}
                    onBlur={(e) => {
                      if (e.target.value !== driver.displayName) {
                        updateDisplayName({ driverId: driver._id, displayName: e.target.value, adminSecret: secret });
                      }
                    }}
                    className="rounded-md border border-transparent bg-transparent px-1 hover:border-neutral-300 dark:hover:border-neutral-700"
                  />
                </td>
                <td className="px-3 py-2 text-neutral-500">{driver.custId}</td>
                <td className="px-3 py-2 tabular-nums">{driver.totalHeats}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => setWatched({ driverId: driver._id, isWatched: !driver.isWatched, adminSecret: secret })}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {driver.isWatched ? "Unwatch" : "Watch"}
                  </button>
                </td>
                <td className="px-3 py-2 flex gap-1">
                  <button
                    onClick={() => setMergeSource({ id: driver._id, name: driver.displayName })}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    Set source
                  </button>
                  <button
                    onClick={() => setMergeTarget({ id: driver._id, name: driver.displayName })}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    Set target
                  </button>
                </td>
              </tr>
            ))}
            {searchText && results?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                  No drivers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
