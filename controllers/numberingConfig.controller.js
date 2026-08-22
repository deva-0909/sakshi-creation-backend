// Module 10: Numbering Configuration master. doc_type and sequence_offset
// are intentionally NOT editable here -- doc_type is the join key every
// transactional RPC calls next_document_number() with, and sequence_offset
// exists only to keep already-issued document numbers continuous after the
// Module 10 migration (see the migration's comment). Editing either from
// this endpoint would either orphan an RPC's lookup or silently jump/repeat
// a document series. Only cosmetic formatting (prefix, separator, whether
// initials are included, zero-padding width) is editable.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, docType:doc_type, label, prefix, separator, includeInitials:include_initials,
  paddingWidth:padding_width, createdAt:created_at, updatedAt:updated_at
`;

exports.getAllNumberingConfigs = async (req, res) => {
  try {
    const { data, error } = await supabase.from("numbering_configs").select(SELECT).eq("is_delete", false).order("label", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching numbering configs: " + error.message });
  }
};

exports.updateNumberingConfig = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid numbering config ID" });
    }
    const { prefix, separator, includeInitials, paddingWidth } = req.body;
    const updateData = {
      ...(prefix !== undefined && { prefix: prefix || null }),
      ...(separator !== undefined && { separator }),
      ...(includeInitials !== undefined && { include_initials: Boolean(includeInitials) }),
      ...(paddingWidth !== undefined && { padding_width: paddingWidth === null || paddingWidth === "" ? null : Number(paddingWidth) }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("numbering_configs").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Numbering config not found" });
    }
    logAudit({ req, action: "update", module: "numberingconfig", recordId: id, newValue: data });
    res.status(200).json({ success: true, message: "Numbering format updated -- applies to the next document generated", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating numbering config: " + error.message });
  }
};
