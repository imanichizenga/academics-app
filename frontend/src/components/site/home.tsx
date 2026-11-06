"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { ContentCard } from "@/components/content/card";
import { api } from "@/lib/api";
import { useSession } from "@/lib/providers";
import type { Card } from "@/lib/types";
import { PullToRefresh } from "./pull-to-refresh";

export function HomeRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const client = useQueryClient();
  const refresh = useCallback(async () => { router.refresh(); await client.invalidateQueries(); }, [router, client]);
  return <PullToRefresh onRefresh={refresh}>{children}</PullToRefresh>;
}

export function ContinueLearning() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ["continue"], enabled: !!user, queryFn: () => api<Card[]>("/catalog/continue/") });
  if (!user || !data?.length) return null;
  return (
    <section className="mt-10 md:mt-14">
      <h2 className="mb-4 text-lg font-semibold tracking-tight md:text-xl">Continue learning</h2>
      <div className="scroll-x -mx-4 flex gap-4 px-4 md:mx-0 md:px-0">
        {data.map((c) => <ContentCard key={c.id} item={c} className="w-[70%] shrink-0 sm:w-[38%] lg:w-[23.4%]" />)}
      </div>
    </section>
  );
}
