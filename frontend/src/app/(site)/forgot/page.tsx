import type { Metadata } from "next";
import { Forgot } from "@/components/site/auth";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };
export default function ForgotPage() { return <Forgot />; }
