/**
 * Minimal layout for /start onboarding — no sidebar, no nav, distraction-free.
 */
export default function StartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
