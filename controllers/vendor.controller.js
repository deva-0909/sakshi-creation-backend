const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { Readable } = require("stream");
const csv = require("csv-parser");

const SELECT =
  "id, name, contactNumber:contact_number, whatsappNumber:whatsapp_number, gst, address, createdAt:created_at, updatedAt:updated_at, companyName:company_name_id(id, companyName:company_name)";

exports.getVendors = async (req, res) => {
  try {
    const { data, error } = await supabase.from("vendors").select(SELECT).order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendors: " + error.message });
  }
};

exports.getVendorById = async (req, res) => {
  try {
    const { data, error } = await supabase.from("vendors").select(SELECT).eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendor: " + error.message });
  }
};

exports.createVendor = async (req, res) => {
  try {
    const { companyName, name, contactNumber, whatsappNumber, gst, address } = req.body;
    if (!companyName || !name || !contactNumber || !whatsappNumber || !address) {
      return res.status(400).json({ success: false, message: "All required fields must be provided" });
    }
    if (!isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: "Invalid company" });
    }

    const { data, error } = await supabase
      .from("vendors")
      .insert({
        company_name_id: companyName,
        name,
        contact_number: contactNumber,
        whatsapp_number: whatsappNumber,
        gst: gst || "",
        address,
      })
      .select(SELECT)
      .single();

    if (error) throw error;

    logAudit({ req, action: "create", module: "vendor", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating vendor: " + error.message });
  }
};

exports.updateVendor = async (req, res) => {
  try {
    const { companyName, name, contactNumber, whatsappNumber, gst, address } = req.body;
    if (companyName && !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    if (companyName) {
      const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
      if (!companyExists) {
        return res.status(400).json({ success: false, message: "Invalid company" });
      }
    }

    const { data: before } = await supabase.from("vendors").select(SELECT).eq("id", req.params.id).maybeSingle();

    const updateData = {
      ...(companyName && { company_name_id: companyName }),
      ...(name && { name }),
      ...(contactNumber && { contact_number: contactNumber }),
      ...(whatsappNumber && { whatsapp_number: whatsappNumber }),
      ...(gst !== undefined && { gst }),
      ...(address && { address }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("vendors")
      .update(updateData)
      .eq("id", req.params.id)
      .select(SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    logAudit({ req, action: "update", module: "vendor", recordId: req.params.id, oldValue: before, newValue: data });

    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating vendor: " + error.message });
  }
};

exports.deleteVendor = async (req, res) => {
  try {
    const { data: before } = await supabase.from("vendors").select(SELECT).eq("id", req.params.id).maybeSingle();

    const { data, error } = await supabase.from("vendors").delete().eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    logAudit({ req, action: "delete", module: "vendor", recordId: req.params.id, oldValue: before });

    res.status(200).json({ success: true, message: "Vendor deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting vendor: " + error.message });
  }
};

exports.bulkCreateVendors = async (req, res) => {
  try {
    const file = req.file;
    const { companyName } = req.body;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    if (!companyName || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Company name is required and must be valid" });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }

    const results = [];
    await new Promise((resolve, reject) => {
      Readable.from(file.buffer)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    const vendors = [];
    for (const row of results) {
      const { name, contactNumber, whatsappNumber, gst, address } = row;
      if (!name || !contactNumber || !whatsappNumber || !address) {
        return res.status(400).json({ success: false, message: `Missing required fields in row: ${JSON.stringify(row)}` });
      }
      if (contactNumber.length !== 10 || !/^[0-9]{10}$/.test(contactNumber)) {
        return res.status(400).json({ success: false, message: `Invalid contact number in row: ${JSON.stringify(row)}` });
      }
      if (whatsappNumber.length !== 10 || !/^[0-9]{10}$/.test(whatsappNumber)) {
        return res.status(400).json({ success: false, message: `Invalid WhatsApp number in row: ${JSON.stringify(row)}` });
      }
      if (gst && !gstRegex.test(gst)) {
        return res.status(400).json({ success: false, message: `Invalid GST number in row: ${JSON.stringify(row)}` });
      }
      vendors.push({
        company_name_id: companyName,
        name,
        contact_number: contactNumber,
        whatsapp_number: whatsappNumber,
        gst: gst || "",
        address,
      });
    }

    const { data: saved, error } = await supabase.from("vendors").insert(vendors).select(SELECT);
    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Bulk vendor upload completed successfully",
      count: saved.length,
      data: withMongoId(saved),
    });
  } catch (error) {
    console.error("Error in bulk upload:", error);
    res.status(500).json({ success: false, message: `Server error during bulk upload: ${error.message}` });
  }
};
