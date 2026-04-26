import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const STORAGE_BACKEND = String(process.env.STORAGE_BACKEND || "local").toLowerCase();

let s3Client: any = null;

export function isS3StorageEnabled() {
  return STORAGE_BACKEND === "s3";
}

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function getS3Client() {
  if (!s3Client) {
    const region = requiredEnv("S3_REGION");
    const accessKeyId = requiredEnv("S3_ACCESS_KEY_ID");
    const secretAccessKey = requiredEnv("S3_SECRET_ACCESS_KEY");
    s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey }
    });
  }
  return s3Client;
}

export function getS3Bucket() {
  return requiredEnv("S3_BUCKET");
}

export function normalizeFilename(name: string) {
  const cleaned = String(name || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 140);
  return cleaned || "file.bin";
}

export function buildS3ObjectKey(input: { companyId: string; caseId: string; fileName: string }) {
  const safeName = normalizeFilename(input.fileName);
  return `companies/${input.companyId}/cases/${input.caseId}/${Date.now()}-${randomUUID()}-${safeName}`;
}

export function isS3StoredLink(link: string) {
  return String(link || "").startsWith("s3://");
}

export function toS3StoredLink(key: string) {
  return `s3://${key}`;
}

export function fromS3StoredLink(link: string) {
  const raw = String(link || "");
  if (!raw.startsWith("s3://")) return "";
  return raw.replace(/^s3:\/\//, "");
}

export async function putObjectToS3(input: {
  key: string;
  content: Buffer;
  contentType?: string;
}) {
  const client = await getS3Client();
  const bucket = getS3Bucket();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.content,
      ContentType: input.contentType || "application/octet-stream"
    })
  );
}

// Retrieve a file from S3 as a Buffer
export async function getObjectFromS3(key: string): Promise<Buffer> {
  const client = await getS3Client();
  const bucket = getS3Bucket();
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const stream = res.Body as any;
  if (!stream) throw new Error("S3 GetObject returned no body");
  // Convert stream to buffer
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getSignedUploadUrl(input: {
  key: string;
  contentType?: string;
  expiresInSeconds?: number;
}) {
  const client = await getS3Client();
  const bucket = getS3Bucket();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ContentType: input.contentType || "application/octet-stream"
  });
  const expiresIn = Math.max(60, Math.min(900, Number(input.expiresInSeconds || 300)));
  return getSignedUrl(client, command, { expiresIn });
}

export async function getSignedDownloadUrl(input: {
  key: string;
  expiresInSeconds?: number;
}) {
  const client = await getS3Client();
  const bucket = getS3Bucket();
  const fileName = String(input.key || "").split("/").pop() || "download.pdf";
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ...(isPdf
      ? {
          ResponseContentType: "application/pdf",
          ResponseContentDisposition: `attachment; filename="${fileName}"`
        }
      : {})
  });
  const expiresIn = Math.max(60, Math.min(900, Number(input.expiresInSeconds || 300)));
  return getSignedUrl(client, command, { expiresIn });
}
