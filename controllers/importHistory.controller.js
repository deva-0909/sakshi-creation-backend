const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");

// §77: bulk-import history. One shared table (import_logs) backs every
// bulk-import module (vendor, staff, material, productItem, lead,
// purchase, accountMaster) — see lib/importLog.js for how rows land
// here.
exports.getImportHistory = async (req, res) => {
  try {
    const { module } = req.params;
    const { page, limit } = req.query;

    let query = supabase
      .from("import_logs")
      .select(
        "id, module, fileName:file_name, totalRows:total_rows, successCount:success_count, failedCount:failed_count, errors, createdAt:created_at, importedBy:imported_by(id, firstName:first_name, lastName:last_name)",
        { count: "exact" }
      )
      .eq("module", module)
      .order("created_at", { ascending: false });

    const paginate = page !== undefined || limit !== undefined;
    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 20;
      from = (pageNum - 1) * limitNum;
      query = query.range(from, from + limitNum - 1);
    } else {
      query = query.limit(50);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const response = { success: true, data: withMongoId(data) };
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
    res.status(500).json({ success: false, message: "Failed to fetch import history", error: error.message });
  }
};
