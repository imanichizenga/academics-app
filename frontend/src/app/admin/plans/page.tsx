import { Suspense } from "react";
import { Plans } from "@/components/admin/manage";

export const metadata = { title: "Plans" };
export default function Page() { return <Suspense><Plans /></Suspense>; }
