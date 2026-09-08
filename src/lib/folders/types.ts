import { z } from "zod";
import { archiveItemSchema } from "@/lib/tracker/archive-job-types";

export const folderNameSchema = z.string().trim().transform(value => value.replace(/\s+/g, " ")).pipe(z.string().min(1).max(80));
export const mediaReferenceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("reddit"), id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict(),
  z.object({ source: z.literal("x"), id: z.string().min(1).max(250), jobId: z.string().uuid() }).strict(),
]);
export type MediaReference = z.infer<typeof mediaReferenceSchema>;
export const mediaKey = (media: Pick<MediaReference, "source" | "id">) => `${media.source}:${media.id}`;
const snapshotSchema = z.object({
  key: z.string(), reference: mediaReferenceSchema, title: z.string(), creator: z.string(),
  postUrl: z.string().url(), previewUrl: z.string(), addedAt: z.string().datetime(),
  type: z.enum(["photo", "video", "animated_gif"]),
  archive: archiveItemSchema.optional(), asset: z.object({ file: z.string().regex(/^[a-f0-9]{64}\.bin$/), mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]) }).optional(),
});
export type FolderMedia = z.infer<typeof snapshotSchema>;
const folderSchema = z.object({ id: z.string().uuid(), name: folderNameSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), itemKeys: z.array(z.string()) });
export const folderStateSchema = z.object({ version: z.literal(1), folders: z.array(folderSchema), items: z.record(z.string(), snapshotSchema) });
export type FolderState = z.infer<typeof folderStateSchema>;
export type FolderSummary = Omit<FolderState["folders"][number], "itemKeys"> & { count: number };
export type FolderList = { folders: FolderSummary[]; memberships: string[] };
export type FolderDetail = { folder: FolderSummary; items: FolderMedia[] };
