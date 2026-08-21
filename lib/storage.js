const path = require("path");
const supabase = require("./supabaseClient");

const BUCKET = "uploads";

// §38: folder/filename that end up in a storage object path used to come
// straight from req.body/req.params with no validation. Supabase Storage
// paths are just string keys (no real filesystem underneath), so
// "../../x" doesn't escape the bucket the way it would on disk -- but an
// unsanitized folder let a caller upload into or, worse, delete/read from
// any arbitrary path in the shared "uploads" bucket, including other
// modules' folders. These two guards constrain both sides: folders to a
// short safe charset, and filenames (on the read/delete paths, where the
// name must reference something this app actually generated) to the
// exact pattern uploadBuffer produces below.
const SAFE_FOLDER = /^[a-zA-Z0-9_-]{1,64}$/;
const GENERATED_FILENAME = /^file-\d+-\d+\.[a-zA-Z0-9]{1,10}$/;

function sanitizeFolder(name) {
  const value = String(name || "").trim();
  return SAFE_FOLDER.test(value) ? value : "general";
}

function isGeneratedFilename(name) {
  return GENERATED_FILENAME.test(String(name || ""));
}

/**
 * Upload a file buffer (from multer memoryStorage) to Supabase Storage
 * and return a public URL, mirroring the old `${BACK_URL}/uploads/<folder>/<filename>` shape.
 */
async function uploadBuffer(buffer, folder, originalName, mimetype) {
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const extension = path.extname(originalName || "");
  const filename = `file-${uniqueSuffix}${extension}`;
  const objectPath = `${sanitizeFolder(folder)}/${filename}`;

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
  sanitizeFolder,
  isGeneratedFilename,
};
