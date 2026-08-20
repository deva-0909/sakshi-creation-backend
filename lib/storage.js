const path = require("path");
const supabase = require("./supabaseClient");

const BUCKET = "uploads";

/**
 * Upload a file buffer (from multer memoryStorage) to Supabase Storage
 * and return a public URL, mirroring the old `${BACK_URL}/uploads/<folder>/<filename>` shape.
 */
async function uploadBuffer(buffer, folder, originalName, mimetype) {
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const extension = path.extname(originalName || "");
  const filename = `file-${uniqueSuffix}${extension}`;
  const objectPath = `${folder || "general"}/${filename}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, buffer, {
      contentType: mimetype || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);

  return {
    path: objectPath,
    filename,
    url: data.publicUrl,
  };
}

async function uploadManyFromMulter(files) {
  const results = [];
  for (const file of files) {
    const folder = file.fieldname === "file" ? "general" : file.fieldname;
    const uploaded = await uploadBuffer(
      file.buffer,
      folder,
      file.originalname,
      file.mimetype
    );
    results.push({ ...uploaded, originalname: file.originalname });
  }
  return results;
}

async function removeObject(objectPath) {
  const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
  if (error) throw new Error(`Failed to delete file: ${error.message}`);
}

function extractPathFromUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.substring(idx + marker.length);
}

module.exports = {
  BUCKET,
  uploadBuffer,
  uploadManyFromMulter,
  removeObject,
  extractPathFromUrl,
};
