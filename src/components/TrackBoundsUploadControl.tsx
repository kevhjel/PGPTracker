import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function TrackBoundsUploadControl({ adminSecret }: { adminSecret: string }) {
  const generateUploadUrl = useMutation(api.gps.generateUploadUrl);
  const parseTrackBounds = useAction(api.actions.parseTrackBounds.run);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const uploadUrl = await generateUploadUrl({ adminSecret });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/geo+json" },
        body: file,
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }
      const { storageId } = await res.json();
      setStatus("Parsing track bounds…");
      await parseTrackBounds({ storageId, sourceFormat: "geojson", adminSecret });
      setStatus(`${file.name} — track bounds updated.`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
        {busy ? "Uploading…" : "Upload track bounds (GeoJSON)"}
        <input type="file" accept=".geojson,.json" className="hidden" onChange={handleFileChange} disabled={busy} />
      </label>
      {status && <span className="text-neutral-500">{status}</span>}
    </div>
  );
}
