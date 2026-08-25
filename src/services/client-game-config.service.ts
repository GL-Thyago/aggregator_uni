import { prisma } from "../lib/prisma.js";
import { targetRtpFromGame } from "../config/rtp.js";

export async function resolveTargetRtpForClientGame(
  clientId: string,
  gameId: number,
  categoryId: number,
  defaultRtp: unknown,
): Promise<number> {
  const entitlement = await prisma.clientEntitlement.findFirst({
    where: {
      clientId,
      categoryId,
      OR: [{ gameId }, { gameId: null }],
      isEnabled: true,
    },
    orderBy: { gameId: "desc" },
    select: { rtpPct: true },
  });

  if (entitlement?.rtpPct !== null && entitlement?.rtpPct !== undefined) {
    return Number(entitlement.rtpPct);
  }

  return targetRtpFromGame(defaultRtp);
}

export async function resolveTargetRtpForSession(session: {
  clientId: string;
  game: { id: number; categoryId: number; rtp: unknown };
}): Promise<number> {
  return resolveTargetRtpForClientGame(
    session.clientId,
    session.game.id,
    session.game.categoryId,
    session.game.rtp,
  );
}
