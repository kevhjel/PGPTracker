import { useState, useCallback } from "react";

const STORAGE_KEY = "pgptimes_admin_secret";

export function useAdminSecret() {
  const [secret, setSecretState] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");

  const setSecret = useCallback((value: string) => {
    localStorage.setItem(STORAGE_KEY, value);
    setSecretState(value);
  }, []);

  return { secret, setSecret };
}
