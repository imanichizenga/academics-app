import { Suspense } from "react";
import { AuditLog } from "@/components/admin/manage";

export const metadata = { title: "Audit Log" };
export default function Page() { return <Suspense><AuditLog /></Suspense>; }
