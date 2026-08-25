/**
 * Exemplo de wallet que o back_uni_fut deve expor para o agregador.
 *
 * Endpoints obrigatórios (base: /api/casino/wallet):
 *
 * POST /balance  → consulta saldo real do usuário
 * POST /spin     → debita aposta, credita prêmio e registra taxas
 *
 * Header em todas as requisições do agregador:
 *   X-Wallet-Signature: HMAC-SHA256(body, walletSecret)
 *
 * Copie src/lib/wallet-sign.ts para validar a assinatura no back_uni_fut.
 */

import express from "express";
import { verifyWalletSignature } from "../src/lib/wallet-sign.js";

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody: string }).rawBody = buf.toString(); } }));

const WALLET_SECRET = process.env.WALLET_SECRET ?? "wallet_dev_secret_change_me";

// Saldo simulado em memória (no back_uni_fut real, use o DB do usuário)
const balances = new Map<string, number>([["user_123", 500]]);

function walletAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const rawBody = (req as express.Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  const signature = req.headers["x-wallet-signature"] as string | undefined;

  if (!verifyWalletSignature(rawBody, signature, WALLET_SECRET)) {
    res.status(401).json({ error: "Invalid wallet signature" });
    return;
  }
  next();
}

app.post("/api/casino/wallet/balance", walletAuth, (req, res) => {
  const { externalUserId } = req.body as { externalUserId: string };
  const balance = balances.get(externalUserId) ?? 0;
  res.json({ balance, currency: "BRL" });
});

app.post("/api/casino/wallet/spin", walletAuth, (req, res) => {
  const {
    externalUserId,
    betAmount,
    winAmount,
    gameFeeAmount,
    clientFeeAmount,
    spinId,
  } = req.body as {
    externalUserId: string;
    betAmount: number;
    winAmount: number;
    gameFeeAmount: number;
    clientFeeAmount: number;
    spinId: string;
  };

  const balanceBefore = balances.get(externalUserId) ?? 0;

  if (balanceBefore < betAmount) {
    res.json({ ok: false, error: "Insufficient balance", balanceBefore, balanceAfter: balanceBefore });
    return;
  }

  const balanceAfter = balanceBefore - betAmount + winAmount;
  balances.set(externalUserId, balanceAfter);

  // No back_uni_fut real:
  // 1. Debitar betAmount do saldo do usuário
  // 2. Creditar winAmount se houver
  // 3. Registrar gameFeeAmount + clientFeeAmount para faturamento interno
  // 4. Persistir transação com spinId

  console.log(`[Wallet] spin ${spinId}: bet=${betAmount} win=${winAmount} gameFee=${gameFeeAmount} clientFee=${clientFeeAmount}`);

  res.json({
    ok: true,
    balanceBefore,
    balanceAfter,
    transactionId: `tx_${spinId}`,
  });
});

app.listen(3011, () => {
  console.log("Wallet demo: http://localhost:3011/api/casino/wallet");
  console.log("Configure no agregador:");
  console.log('  walletUrl: "http://localhost:3011/api/casino/wallet"');
  console.log(`  walletSecret: "${WALLET_SECRET}"`);
});
