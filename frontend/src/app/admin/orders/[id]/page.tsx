import { OrderDetail } from "@/components/admin/people";

export const metadata = { title: "Order" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OrderDetail id={id} />; }
