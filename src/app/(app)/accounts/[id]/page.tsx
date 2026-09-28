import { redirect } from "next/navigation";

/** Inboxes open in the side drawer on the Email accounts page. */
export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ connected?: string }> }) {
  const { id } = await params;
  const { connected } = await searchParams;
  redirect(`/accounts?account=${id}${connected ? "&connected=1" : ""}`);
}
