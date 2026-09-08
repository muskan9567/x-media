import type { Metadata } from "next";
import { PostsExplorer } from "@/components/posts/posts-explorer";

export const metadata: Metadata = { title: "Tweets · X Media", description: "Find an account's recent tweets, popular posts, and short bangers in your saved public timeline." };
export default function PostsPage() { return <PostsExplorer />; }
