import { UserDetail } from "@/components/admin/people";

export const metadata = { title: "User" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <UserDetail id={id} />; }
