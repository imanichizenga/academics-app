import type { Metadata } from "next";
import { Suspense } from "react";
import { ChangePassword } from "@/components/site/auth";

export const metadata: Metadata = { title: "Change password", robots: { index: false } };
export default function Page() { return <Suspense><ChangePassword /></Suspense>; }
