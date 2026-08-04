export const USION_API_ORIGIN = "https://mobile.mongolai.mn";

export type UsionPlayerProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function avatarUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw, USION_API_ORIGIN);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function parseUsionPlayerProfile(
  value: unknown,
  expectedId: string,
): UsionPlayerProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Record<string, unknown>;
  const id = text(profile.id);
  if (!id || id !== expectedId) return null;
  const name = text(profile.name);
  const username = text(profile.username);
  return {
    id,
    displayName: name || (username ? `@${username}` : "Opponent"),
    avatarUrl: avatarUrl(profile.avatar),
  };
}
