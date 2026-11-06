import type { Metadata } from "next";
import { Signup } from "@/components/site/auth";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };
export default function SignupPage() { return <Signup />; }
