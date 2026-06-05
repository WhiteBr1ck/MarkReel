import { redirect } from "next/navigation";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/app/player?share=${encodeURIComponent(token)}`);
}
