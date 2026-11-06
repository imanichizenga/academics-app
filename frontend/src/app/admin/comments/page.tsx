import { Suspense } from "react";
import { Moderation } from "@/components/admin/manage";

export const metadata = { title: "Moderation" };
export default function Page() { return <Suspense><Moderation /></Suspense>; }
