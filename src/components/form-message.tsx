export function FormMessage({ state }: { state: { error?: string; message?: string } }) {
  if (state.error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.message}</p>;
  return null;
}
