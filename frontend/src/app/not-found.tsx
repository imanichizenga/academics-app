import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-fg-2">The page you are looking for does not exist.</p>
        <Link href="/" className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg">Go home</Link>
      </div>
    </main>
  );
}
