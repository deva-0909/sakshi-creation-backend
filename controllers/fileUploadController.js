const { uploadBuffer, uploadManyFromMulter, sanitizeFolder, isGeneratedFilename } = require("../lib/storage");
const supabase = require("../lib/supabaseClient");

// Upload single file -> Supabase Storage
exports.uploadSingleFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const folderName = sanitizeFolder(req.body.folder);
    const uploaded = await uploadBuffer(req.file.buffer, folderName, req.file.originalname, req.file.mimetype);

    res.status(200).json({
      success: true,
      message: "File uploaded successfully",
      data: {
        filename: uploaded.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        folder: folderName,
        url: uploaded.url,
        path: uploaded.path,
      },
    });
  } catch (error) {
    console.error("File upload error:", error);
    res.status(500).json({ success: false, message: "File upload failed", error: error.message });
  }
};

// Upload multiple files -> Supabase Storage
exports.uploadMultipleFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }
    const folderName = sanitizeFolder(req.body.folder);

    const uploaded = await Promise.all(
      req.files.map(async (file) => {
        const result = await uploadBuffer(file.buffer, folderName, file.originalname, file.mimetype);
        return {
          filename: result.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          folder: folderName,
          url: result.url,
          path: result.path,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: `${uploaded.length} files uploaded successfully to ${folderName} folder`,
      data: uploaded,
    });
  } catch (error) {
    console.error("Multiple file upload error:", error);
    res.status(500).json({ success: false, message: "File upload failed", error: error.message });
  }
};

// Delete file from Supabase Storage
exports.deleteFile = async (req, res) => {
  try {
    const { folder, filename } = req.params;
    // §38: folder/filename come straight from the URL. Reject anything
    // that isn't exactly the shape this app generates, rather than
    // silently normalizing it -- a caller shouldn't be able to point
    // this at an arbitrary object path in the shared bucket.
    if (sanitizeFolder(folder) !== folder || !isGeneratedFilename(filename)) {
      return res.status(400).json({ success: false, message: "Invalid folder or filename" });
    }
    const objectPath = `${folder}/${filename}`;
    const { error } = await supabase.storage.from("uploads").remove([objectPath]);
    if (error) throw error;
    res.status(200).json({ success: true, message: "File deleted successfully" });
  } catch (error) {
    console.error("File delete error:", error);
    res.status(500).json({ success: false, message: "File deletion failed", error: error.message });
  }
};

// Get file info
exports.getFileInfo = async (req, res) => {
  try {
    const { folder, filename } = req.params;
    if (sanitizeFolder(folder) !== folder || !isGeneratedFilename(filename)) {
      return res.status(400).json({ success: false, message: "Invalid folder or filename" });
    }
    const { data, error } = await supabase.storage.from("uploads").list(folder, { search: filename });
    if (error) throw error;
    const file = (data || []).find((f) => f.name === filename);
    if (!file) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(`${folder}/${filename}`);
    res.status(200).json({
      success: true,
      data: {
        filename,
        folder,
        size: file.metadata?.size,
        url: urlData.publicUrl,
        path: `${folder}/${filename}`,
        createdAt: file.created_at,
        modifiedAt: file.updated_at,
      },
    });
  } catch (error) {
    console.error("Get file info error:", error);
    res.status(500).json({ success: false, message: "Failed to get file info", error: error.message });
  }
};

// List all uploads (top-level folders)
exports.listUploads = async (req, res) => {
  try {
    const { data: folders, error } = await supabase.storage.from("uploads").list("");
    if (error) throw error;

    const foldersWithFiles = await Promise.all(
      (folders || [])
        .filter((f) => f.id === null) // folders have no id in Supabase Storage listing
        .map(async (folder) => {
          const { data: files } = await supabase.storage.from("uploads").list(folder.name);
          return { folder: folder.name, fileCount: (files || []).length, files: (files || []).map((f) => f.name) };
        })
    );

    res.status(200).json({ success: true, data: { totalFolders: foldersWithFiles.length, folders: foldersWithFiles } });
  } catch (error) {
    console.error("List uploads error:", error);
    res.status(500).json({ success: false, message: "Failed to list uploads", error: error.message });
  }
};
