import { Router } from "express";
import { z } from "zod";
import { authMiddleware, type AuthenticatedRequest } from "../../../auth/middleware.js";
import {
  depositToWallet,
  getWalletBalance,
  withdrawFromWallet,
} from "../../../services/player-wallet.service.js";

const router = Router();

const depositSchema = z.object({
  externalUserId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default("BRL"),
  referenceId: z.string().optional(),
});

router.post("/wallet/deposit", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await depositToWallet({
      clientId: req.client!.id,
      ...parsed.data,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Deposit failed" });
  }
});

router.post("/wallet/withdraw", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await withdrawFromWallet({
      clientId: req.client!.id,
      ...parsed.data,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Withdraw failed" });
  }
});

router.get("/wallet/balance/:externalUserId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const externalUserId = String(req.params.externalUserId);
  const currency = String(req.query.currency ?? "BRL");
  const balance = await getWalletBalance(req.client!.id, externalUserId, currency);
  res.json({ externalUserId, balance, currency });
});

export default router;
