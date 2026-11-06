import { ContentEditor } from "@/components/admin/content-editor";

export const metadata = { title: "Edit content" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ContentEditor id={id} />; }
