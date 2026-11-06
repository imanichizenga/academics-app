import { Loader2 } from "lucide-react";

/** Snippe's hosted checkout returns here. CheckoutProvider resumes the saved order on mount. */
export default function ReturnPage() {
  return <div className="grid min-h-[50dvh] place-items-center text-sm text-fg-2"><span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden />Checking your payment…</span></div>;
}
