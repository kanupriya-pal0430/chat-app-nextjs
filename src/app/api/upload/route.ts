import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, validMutationOrigin } from "@/lib/server/auth";
import { database } from "@/lib/server/db";
import { fileTypeFromBuffer } from "file-type";
import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";
export const runtime = "nodejs";
const MAX_BYTES = 15 * 1024 * 1024;
const accepted: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/webm": "video",
};
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validMutationOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const lengthHeader = request.headers.get("content-length");
  if (!lengthHeader || !/^\d+$/.test(lengthHeader))
    return NextResponse.json(
      { error: "Upload content length is required" },
      { status: 411 }
    );
  const contentLength = Number(lengthHeader);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength > MAX_BYTES + 1024 * 1024
  )
    return NextResponse.json({ error: "File exceeds 15 MB" }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES)
    return NextResponse.json(
      { error: "File must be 1 byte to 15 MB" },
      { status: 413 }
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = await fileTypeFromBuffer(bytes);
  const kind = sniffed ? accepted[sniffed.mime] : undefined;
  if (!kind) {
    return NextResponse.json(
      { error: "Unsupported media format" },
      { status: 415 }
    );
  }
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET)
    return NextResponse.json(
      { error: "Cloudinary is not configured" },
      { status: 503 }
    );
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  try {
    const result = await new Promise<{ secure_url: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: kind,
            folder: "relay-chat",
            allowed_formats:
              kind === "image"
                ? ["jpg", "jpeg", "png", "webp", "gif"]
                : ["mp4", "webm"],
            overwrite: false,
            unique_filename: true,
          },
          (err, data) => {
            if (err || !data) reject(err ?? new Error("Upload failed"));
            else resolve(data);
          }
        );
        stream.end(bytes);
      }
    );
    const id = randomUUID();
    const name = file.name.slice(0, 128).replace(/[\u0000-\u001f]/g, "");
    database()
      .prepare(
        "INSERT INTO uploads(id,ownerId,url,kind,name,usedAt) VALUES(?,?,?,?,?,NULL)"
      )
      .run(id, user.id, result.secure_url, kind, name);
    return NextResponse.json({
      media: { id, url: result.secure_url, kind, name },
    });
  } catch (error) {
    console.error("Cloudinary upload failed", error);
    return NextResponse.json(
      { error: "Upload failed. Please retry." },
      { status: 502 }
    );
  }
}
