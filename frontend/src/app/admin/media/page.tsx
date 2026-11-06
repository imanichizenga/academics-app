import { Suspense } from "react";
import { MediaLibrary } from "@/components/admin/manage";

export const metadata = { title: "Media Library" };
export default function Page() { return <Suspense><MediaLibrary /></Suspense>; }
