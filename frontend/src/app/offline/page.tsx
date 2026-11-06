export const metadata = { title: "Offline" };
export default function Offline() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">You are offline</h1>
        <p className="mt-2 text-fg-2">Check your connection, then try again.</p>
        <a href="/" className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg">Try again</a>
      </div>
    </main>
  );
}
