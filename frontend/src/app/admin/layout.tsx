import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/shell";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false } };
export default function Layout({ children }: { children: ReactNode }) { return <AdminShell>{children}</AdminShell>; }
