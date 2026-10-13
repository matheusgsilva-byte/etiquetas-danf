"use client";

import { useCallback, useEffect, useState } from "react";
import type { OutputSettings } from "../output-settings";
import type { Limits } from "../plans";
import { api } from "./api";

export interface Me {
  user: { id: string; name: string; email: string };
  role: "OWNER" | "ADMIN" | "MEMBER";
  org: {
    id: string;
    name: string;
    retentionDays: number;
    deleteSourcesAfterGeneration: boolean;
    defaultSettings: OutputSettings;
  };
  limits: Limits;
  usage: { labelsThisMonth: number; storageBytes: number; members: number };
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<Me>("/api/me")
      .then((d) => (setMe(d), setError(null)))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => reload(), [reload]);
  return { me, error, reload };
}
