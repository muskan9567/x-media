import { FoldersExplorer } from "@/components/folders/folders-explorer";
export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <FoldersExplorer key={id} folderId={id} />; }
