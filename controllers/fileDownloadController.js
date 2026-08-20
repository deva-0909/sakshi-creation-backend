const path = require("path");
const supabase = require("../lib/supabaseClient");
const { extractPathFromUrl } = require("../lib/storage");

const contentTypeMap = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
};

// Resolve whatever the client sends (a full Supabase public URL, an "/uploads/<folder>/<file>" path,
// or a bare storage object path) down to the storage object path.
function resolveObjectPath(filePath) {
  const decoded = decodeURIComponent(filePath);
  if (decoded.startsWith("http")) {
    return extractPathFromUrl(decoded);
  }
  return decoded.replace(/^\/?uploads\//, "").replace(/^\/+/, "");
}

exports.downloadFile = async (req, res) => {
  try {
    const { filePath, view } = req.query;
    if (!filePath) {
      return res.status(400).json({ success: false, message: "File path is required" });
    }

    const objectPath = resolveObjectPath(filePath);
    if (!objectPath) {
      return res.status(400).json({ success: false, message: "Invalid file path" });
    }

    const { data: fileBlob, error } = await supabase.storage.from("uploads").download(objectPath);
    if (error || !fileBlob) {
      return res.status(404).json({ success: false, message: "File not found" });
    }

    const fileName = path.basename(objectPath);
    const fileExtension = path.extname(fileName).toLowerCase();
    const contentType = contentTypeMap[fileExtension] || "application/octet-stream";

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `${view === "true" ? "inline" : "attachment"}; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    console.error("Download error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "File download failed", error: error.message });
    }
  }
};

exports.getFileInfo = async (req, res) => {
  try {
    const { filePath } = req.params;
    const objectPath = resolveObjectPath(filePath);
    const folder = path.dirname(objectPath);
    const fileName = path.basename(objectPath);

    const { data: files, error } = await supabase.storage.from("uploads").list(folder === "." ? "" : folder, { search: fileName });
    if (error) throw error;
    const file = (files || []).find((f) => f.name === fileName);
    if (!file) {
      return res.status(404).json({ success: false, message: "File not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        fileName,
        filePath: objectPath,
        size: file.metadata?.size,
        extension: path.extname(fileName).toLowerCase(),
        createdAt: file.created_at,
        modifiedAt: file.updated_at,
        isFile: true,
        isDirectory: false,
      },
    });
  } catch (error) {
    console.error("Get file info error:", error);
    res.status(500).json({ success: false, message: "Failed to get file info", error: error.message });
  }
};

exports.listFiles = async (req, res) => {
  try {
    const directory = req.params.directory || "";
    const { data: files, error } = await supabase.storage.from("uploads").list(directory);
    if (error) throw error;

    const fileList = (files || []).map((f) => ({
      name: f.name,
      path: directory ? `${directory}/${f.name}` : f.name,
      isFile: f.id !== null,
      isDirectory: f.id === null,
      size: f.metadata?.size,
      createdAt: f.created_at,
      modifiedAt: f.updated_at,
    }));

    res.status(200).json({
      success: true,
      data: {
        directory,
        files: fileList,
        totalFiles: fileList.filter((f) => f.isFile).length,
        totalDirectories: fileList.filter((f) => f.isDirectory).length,
      },
    });
  } catch (error) {
    console.error("List files error:", error);
    res.status(500).json({ success: false, message: "Failed to list files", error: error.message });
  }
};
