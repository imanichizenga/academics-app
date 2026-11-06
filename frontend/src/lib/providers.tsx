"use client";
import * as TooltipP from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { ApiError, api, hasSessionCookie, patch, post, refreshSession, setApiLang } from "./api";
import { dictionaries, type Dict, type Lang } from "./i18n";
import type { Site, User } from "./types";

const SiteContext = createContext<Site | null>(null);
export const useSite = () => useContext(SiteContext)!;

const LangContext = createContext<{ t: Dict; lang: Lang; setLang: (next: Lang) => void }>({ t: dictionaries.en, lang: "en", setLang: () => {} });
export const useT = () => useContext(LangContext);
const LANG_COOKIE_AGE = 60 * 60 * 24 * 365;
const writeLangCookie = (next: Lang) => { document.cookie = `lang=${next}; path=/; max-age=${LANG_COOKIE_AGE}; samesite=lax`; };

/** The server picks the first language. Changing it reloads server-rendered text through router.refresh. */
function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setState] = useState(initial);
  const router = useRouter();
  const client = useQueryClient();
  const { user, viewingAs } = useSession();
  setApiLang(lang);
  const apply = useCallback((next: Lang) => {
    setState(next);
    setApiLang(next);
    writeLangCookie(next);
    document.documentElement.lang = next;
    router.refresh();
  }, [router]);
  const setLang = useCallback((next: Lang) => {
    apply(next);
    if (client.getQueryData<Session>(["session"])?.user) patch("/auth/me/", { language: next }).catch(() => {});
  }, [apply, client]);
  // A saved account choice follows the student to a new device; a first login adopts the current one.
  useEffect(() => {
    if (!user || viewingAs) return;
    if (!user.language) patch("/auth/me/", { language: lang }).catch(() => {});
    else if (user.language !== lang) apply(user.language);
  }, [user?.id, viewingAs]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ t: dictionaries[lang], lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export type Session = { user: User | null; viewing_as?: boolean };
const noSubscribe = () => () => {};
export function useSession() {
  // Parts of a page hydrate late, after this query may have resolved. Until a component has hydrated it
  // must see what the server saw, or React throws the whole tree away.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const query = useQuery<Session>({
    queryKey: ["session"], staleTime: 60_000,
    queryFn: async () => {
      const first = await api<Session>("/auth/me/");
      if (first.user || !hasSessionCookie()) return first;
      // The access cookie lapsed but a refresh token may still be valid.
      return (await refreshSession()) ? api<Session>("/auth/me/") : first;
    },
  });
  if (!hydrated) return { user: null, viewingAs: undefined, loading: true };
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

export function Providers({ site, lang, children }: { site: Site; lang: Lang; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status < 500 && e.status > 0), refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={client}>
      <SiteContext.Provider value={site}>
        <MotionConfig reducedMotion="user">
          <TooltipP.Provider>
            <KeepSessionAlive />
            <LangProvider initial={lang}>{children}</LangProvider>
            <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} style={{ zIndex: 70 }} />
          </TooltipP.Provider>
        </MotionConfig>
      </SiteContext.Provider>
    </QueryClientProvider>
  );
}
