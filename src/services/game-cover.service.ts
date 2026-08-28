import { prisma } from "../lib/prisma.js";
import { decodeSalsaThumbnail } from "./salsa/salsa-logo.service.js";

export async function getGameCoverPayload(slug: string) {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { thumbnailUrl: true },
  });
  if (!game) return null;

  const decoded = decodeSalsaThumbnail(game.thumbnailUrl);
  if (decoded) {
    return { buffer: decoded.buffer, contentType: decoded.contentType };
  }

  if (game.thumbnailUrl && /^https:\/\//i.test(game.thumbnailUrl)) {
    return { redirect: game.thumbnailUrl };
  }

  return null;
}
