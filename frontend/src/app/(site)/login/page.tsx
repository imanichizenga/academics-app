import type { Metadata } from "next";
import { Suspense } from "react";
import { Login } from "@/components/site/auth";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };
export default function LoginPage() { return <Suspense><Login /></Suspense>; }
