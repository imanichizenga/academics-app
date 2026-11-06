"use client";
import * as TooltipP from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { ApiError, api, hasSessionCookie, post, refreshSession } from "./api";
import type { Site, User } from "./types";

const SiteContext = createContext<Site | null>(null);
export const useSite = () => useContext(SiteContext)!;

export type Session = { user: User | null; viewing_as?: boolean };
export function useSession() {
  const query = useQuery<Session>({
    queryKey: ["session"], staleTime: 60_000,
    queryFn: async () => {
      const first = await api<Session>("/auth/me/");
      if (first.user || !hasSessionCookie()) return first;
      // The access cookie lapsed but a refresh token may still be valid.
      return (await refreshSession()) ? api<Session>("/auth/me/") : first;
    },
  });
  return { user: query.data?.user ?? null, viewingAs: query.data?.viewing_as, loading: query.isLoading };
}

/** Mutation with the two things every button needs: a pending flag and a toast on the outcome. */
export function useAction<V = void, R = any>(fn: (v: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: unknown[][]; onSuccess?: (r: R, v: V) => void; onError?: (e: ApiError) => void } = {}) {
  const client = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: fn,
    onSuccess: (result, variables) => {
      opts.invalidate?.forEach((key) => client.invalidateQueries({ queryKey: key }));
      const text = typeof opts.success === "function" ? opts.success(result) : opts.success;
      if (text) toast.success(text);
      opts.onSuccess?.(result, variables);
    },
    onError: (error) => {
      if (opts.onError) opts.onError(error);
      else toast.error(error.message);
    },
  });
}

function KeepSessionAlive() {
  const { user } = useSession();
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => { refreshSession(); }, 12 * 60 * 1000);
    return () => clearInterval(timer);
  }, [user]);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

export function logout(client: QueryClient, everywhere = false) {
  return post(everywhere ? "/auth/logout-all/" : "/auth/logout/").finally(() => { client.clear(); location.href = "/"; });
}

export function Providers({ site, children }: { site: Site; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status < 500 && e.status > 0), refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={client}>
      <SiteContext.Provider value={site}>
        <MotionConfig reducedMotion="user">
          <TooltipP.Provider>
            <KeepSessionAlive />
            {children}
            <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} style={{ zIndex: 70 }} />
          </TooltipP.Provider>
        </MotionConfig>
      </SiteContext.Provider>
    </QueryClientProvider>
  );
}
