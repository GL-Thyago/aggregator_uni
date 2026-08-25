import { Router } from "express";
import express from "express";
import { handleSalsaPublisherRequest } from "../../../services/salsa/salsa-publisher.service.js";
import { getSalsaIntegrationStatus } from "../../../services/salsa/salsa-sync.service.js";

const router = Router();

function xmlFromBody(body: unknown): string {
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.xml === "string") return rec.xml;
    if (typeof rec.PKT === "string") return rec.PKT;
    const firstString = Object.values(rec).find((v) => typeof v === "string" && String(v).includes("<PKT"));
    if (typeof firstString === "string") return firstString;
  }
  return "";
}

router.get("/salsa/publisher", async (_req, res) => {
  const status = await getSalsaIntegrationStatus();
  res.json({
    ok: true,
    endpoint: "POST /api/v1/salsa/publisher",
    publisherUrl: status.publisherUrl,
    enabled: status.enabled,
    configured: status.configured,
  });
});

/** Endpoint único exigido pela Salsa (XML POST) — configure esta URL na Salsa */
router.post(
  "/salsa/publisher",
  express.text({ type: ["text/xml", "application/xml", "text/*", "*/*"] }),
  async (req, res) => {
    const xml = xmlFromBody(req.body) || xmlFromBody(req.query);
    console.log(
      `[Salsa] POST publisher ct=${req.headers["content-type"] ?? "-"} bytes=${xml.length} ip=${req.ip}`,
    );
    try {
      const response = await handleSalsaPublisherRequest(xml);
      res.set("Content-Type", "text/xml; charset=UTF-8");
      res.send(response);
    } catch (err) {
      console.error("[Salsa] Publisher error:", err);
      res.status(500).set("Content-Type", "text/xml; charset=UTF-8");
      res.send(
        `<?xml version="1.0"?><PKT><Result Name="Error" Success="0"><Returnset><Error Type="string" Value="Internal error" /><ErrorCode Type="string" Value="500" /></Returnset></Result></PKT>`,
      );
    }
  },
);

router.get("/salsa/status", async (_req, res) => {
  res.json(await getSalsaIntegrationStatus());
});

export default router;
