const supabase = require("../lib/supabaseClient");
const { Readable } = require("stream");
const csv = require("csv-parser");

const SELECT =
  "id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm, createdAt:created_at, updatedAt:updated_at";

exports.createMaterial = async (req, res) => {
  try {
    const requiredFields = ["materialName", "materialSize", "materialGSM"];
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({ success: false, message: `Missing required field: ${field}` });
      }
    }

    const { data: existingMaterial } = await supabase
      .from("materials")
      .select("id")
      .eq("material_name", req.body.materialName)
      .eq("material_size", req.body.materialSize)
      .eq("material_gsm", req.body.materialGSM)
      .maybeSingle();

    if (existingMaterial) {
      return res.status(400).json({
        success: false,
        message: "Material with this name, size, and GSM already exists",
      });
    }

    const { data, error } = await supabase
      .from("materials")
      .insert({
        material_name: req.body.materialName,
        material_size: req.body.materialSize,
        material_gsm: req.body.materialGSM,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, message: "Material created successfully", data: { ...data, _id: data.id } });
  } catch (error) {
    console.error("Error creating material:", error);
    res.status(500).json({ success: false, message: "Failed to create material", error: error.message });
  }
};

exports.getAllMaterials = async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("materials").select(SELECT, { count: "exact" }).eq("is_delete", false);

    if (search && String(search).trim()) {
      query = query.ilike("material_name", `%${String(search).trim()}%`);
    }

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 10;
      from = (pageNum - 1) * limitNum;
      const to = from + limitNum - 1;
      query = query.range(from, to);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const response = {
      success: true,
      message: "Materials retrieved successfully",
      data: data.map((m) => ({ ...m, _id: m.id })),
    };
    if (paginate) {
      response.pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalCount: count,
        hasNext: from + data.length < count,
        hasPrev: pageNum > 1,
      };
    }
    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching materials:", error);
    res.status(500).json({ success: false, message: "Failed to fetch materials", error: error.message });
  }
};

exports.getMaterialById = async (req, res) => {
  try {
    const { data, error } = await supabase.from("materials").select(SELECT).eq("id", req.params.id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }
    res.status(200).json({ success: true, message: "Material retrieved successfully", data: { ...data, _id: data.id } });
  } catch (error) {
    console.error("Error fetching material:", error);
    res.status(500).json({ success: false, message: "Failed to fetch material", error: error.message });
  }
};

exports.updateMaterial = async (req, res) => {
  try {
    if (req.body.materialName || req.body.materialSize || req.body.materialGSM) {
      let q = supabase.from("materials").select("id").neq("id", req.params.id);
      if (req.body.materialName) q = q.eq("material_name", req.body.materialName);
      if (req.body.materialSize) q = q.eq("material_size", req.body.materialSize);
      if (req.body.materialGSM) q = q.eq("material_gsm", req.body.materialGSM);
      const { data: existingMaterial } = await q.maybeSingle();
      if (existingMaterial) {
        return res.status(400).json({
          success: false,
          message: "Material with this name, size, and GSM already exists",
        });
      }
    }

    const updateData = {
      ...(req.body.materialName && { material_name: req.body.materialName }),
      ...(req.body.materialSize && { material_size: req.body.materialSize }),
      ...(req.body.materialGSM && { material_gsm: req.body.materialGSM }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data, error } = await supabase
      .from("materials")
      .update(updateData)
      .eq("id", req.params.id)
      .select(SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }

    res.status(200).json({ success: true, message: "Material updated successfully", data: { ...data, _id: data.id } });
  } catch (error) {
    console.error("Error updating material:", error);
    res.status(500).json({ success: false, message: "Failed to update material", error: error.message });
  }
};

exports.deleteMaterial = async (req, res) => {
  try {
    const { data, error } = await supabase.from("materials").update({ is_delete: true }).eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }
    res.status(200).json({ success: true, message: "Material deleted successfully" });
  } catch (error) {
    console.error("Error deleting material:", error);
    res.status(500).json({ success: false, message: "Failed to delete material", error: error.message });
  }
};

exports.bulkCreateMaterials = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const results = [];
    await new Promise((resolve, reject) => {
      Readable.from(file.buffer)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    const materials = [];
    const errors = [];

    for (const row of results) {
      const { materialName, materialSize, materialGSM } = row;
      if (!materialName?.trim() || !materialSize?.trim() || !materialGSM?.trim()) {
        errors.push(`Missing required fields in row: ${JSON.stringify(row)}`);
        continue;
      }
      const cleanedGSM = materialGSM.replace(/[^0-9.]/g, "");
      const gsmNumber = parseFloat(cleanedGSM);
      if (isNaN(gsmNumber) || gsmNumber <= 0) {
        errors.push(`Invalid GSM in row: ${JSON.stringify(row)}`);
        continue;
      }

      const { data: existingMaterial } = await supabase
        .from("materials")
        .select("id")
        .eq("material_name", materialName.trim())
        .eq("material_size", materialSize.trim())
        .eq("material_gsm", gsmNumber)
        .maybeSingle();

      if (existingMaterial) {
        errors.push(`Material already exists: ${materialName}, ${materialSize}, ${gsmNumber} GSM`);
        continue;
      }

      materials.push({
        material_name: materialName.trim(),
        material_size: materialSize.trim(),
        material_gsm: gsmNumber,
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: "Some rows contain errors", errors });
    }

    const { data: saved, error } = await supabase.from("materials").insert(materials).select(SELECT);
    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Bulk material upload completed successfully",
      count: saved.length,
      data: saved.map((m) => ({ ...m, _id: m.id })),
    });
  } catch (error) {
    console.error("Error in bulk upload:", error);
    res.status(500).json({ success: false, message: `Server error during bulk upload: ${error.message}` });
  }
};
