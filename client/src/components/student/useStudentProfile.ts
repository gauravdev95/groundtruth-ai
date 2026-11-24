"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchProfile, type FullProfile } from "@/lib/student";

/**
 * Loads the signed-in student's full profile once, and hands back a
 * refresh() so every form can re-read the server state after it saves.
 * The server is the source of truth — the client never edits profile
 * data locally without a round-trip.
 */
export function useStudentProfile() {
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfile(await fetchProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, loading, error, refresh, setProfile };
}
