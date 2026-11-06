import { Suspense } from "react";
import { Categories } from "@/components/admin/manage";

export const metadata = { title: "Categories" };
export default function Page() { return <Suspense><Categories /></Suspense>; }
