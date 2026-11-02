export function playerVersionHref(query: string, mediaId: string) {
  const params = new URLSearchParams(query);
  params.set("mid", mediaId);
  return `/app/player?${params.toString()}`;
}
