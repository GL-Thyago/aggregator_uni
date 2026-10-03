import crypto from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

let client: S3Client | null = null;

function getClient() {
  if (!env.S3_BUCKET) {
    throw new Error("Armazenamento não configurado. Defina S3_BUCKET e as credenciais AWS.");
  }
  client ??= new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return client;
}

function publicUrl(key: string) {
  if (env.S3_PUBLIC_BASE_URL) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  if (env.S3_ENDPOINT) {
    return `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`;
  }
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
}

export function isCatalogImageStorageConfigured() {
  return Boolean(env.S3_BUCKET);
}

export async function uploadCatalogImage(input: {
  buffer: Buffer;
  contentType: string;
  scope: "providers" | "games";
  entityId: number;
}) {
  const extension = EXTENSIONS[input.contentType];
  if (!extension) throw new Error("Formato inválido. Envie PNG, JPG, WEBP ou GIF.");

  const key = `provider-catalog/${input.scope}/${input.entityId}/${crypto.randomUUID()}.${extension}`;
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      Body: input.buffer,
      ContentType: input.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return publicUrl(key);
}
