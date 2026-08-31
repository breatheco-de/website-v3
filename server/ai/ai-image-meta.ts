export type AiRequestedBy = {
  kind: "user" | "agent" | "system";
  id?: string;
  name?: string;
};

export type AiMetaSidecar = {
  prompt: string;
  model: string;
  generated_at?: string;
  aspect_ratio?: string;
  requested_by?: AiRequestedBy;
};

/** Derive sidecar object key/filename from primary media key (swap extension → .json). */
export function aiMetaKeyFromMediaKey(mediaKey: string): string {
  const base = mediaKey.replace(/\.[^.\/]+$/, "");
  return `${base}.json`;
}
