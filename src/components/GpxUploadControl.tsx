import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function GpxUploadControl({ adminSecret }: { adminSecret: string }) {
  const generateUploadUrl = useMutation(api.gps.generateUploadUrl);
  const createSession = useMutation(api.gps.createSession);
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
        headers: { "Content-Type": file.type || "application/gpx+xml" },
        body: file,
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }
      const { storageId } = await res.json();
      await createSession({ storageId, fileName: file.name, adminSecret });
      setStatus(`${file.name} uploaded — parsing…`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
        {busy ? "Uploading…" : "Upload GPX file"}
        <input type="file" accept=".gpx" className="hidden" onChange={handleFileChange} disabled={busy} />
      </label>
      {status && <span className="text-neutral-500">{status}</span>}
    </div>
  );
}
