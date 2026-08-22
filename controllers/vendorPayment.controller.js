const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, paymentNumber:payment_number, amount, paymentDate:payment_date, mode, referenceNumber:reference_number, notes,
  createdAt:created_at,
  vendor:vendor_id(id, name),
  purchaseOrder:purchase_order_id(id, poNumber:po_number, status),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createVendorPayment = async (req, res) => {
  try {
    const { vendorId, purchaseOrderId, companyName, amount, paymentDate, mode, referenceNumber, notes } = req.body;
    if (!isValidId(vendorId) || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid vendorId or companyName" });
    }
    if (purchaseOrderId && !isValidId(purchaseOrderId)) {
      return res.status(400).json({ success: false, message: "Invalid purchaseOrderId" });
    }

    const { data: vendor } = await supabase.from("vendors").select("id").eq("id", vendorId).eq("is_delete", false).maybeSingle();
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    if (purchaseOrderId) {
      const { data: po } = await supabase
        .from("purchase_orders")
        .select("id, vendor_id")
        .eq("id", purchaseOrderId)
        .eq("is_delete", false)
        .maybeSingle();
      if (!po) {
        return res.status(404).json({ success: false, message: "Purchase order not found" });
      }
      if (String(po.vendor_id) !== String(vendorId)) {
        return res.status(400).json({ success: false, message: "vendorId does not match the purchase order's vendor" });
      }
    }

    const initials = deriveInitials(company.company_name);

    const { data: paymentId, error } = await supabase.rpc("record_vendor_payment_transactional", {
      p_vendor_id: vendorId,
      p_purchase_order_id: purchaseOrderId || null,
      p_company_name_id: companyName,
      p_amount: Number(amount),
      p_payment_date: paymentDate,
      p_mode: mode,
      p_reference_number: referenceNumber || null,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("vendor_payments").select(SELECT).eq("id", paymentId).single();
    logAudit({ req, action: "create", module: "vendorpayment", recordId: paymentId, newValue: populated });

    res.status(201).json({ success: true, message: "Vendor payment recorded successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording vendor payment: " + error.message });
  }
};

exports.getAllVendorPayments = async (req, res) => {
  try {
    const { vendorId, purchaseOrderId, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("vendor_payments").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (purchaseOrderId) query = query.eq("purchase_order_id", purchaseOrderId);
    if (search && String(search).trim()) query = query.ilike("payment_number", `%${String(search).trim()}%`);

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 10;
      from = (pageNum - 1) * limitNum;
      query = query.range(from, from + limitNum - 1);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const response = { success: true, count: data.length, data: withMongoId(data) };
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
    res.status(500).json({ success: false, message: "Error fetching vendor payments: " + error.message });
  }
};

exports.getVendorPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor payment ID" });
    }
    const { data, error } = await supabase.from("vendor_payments").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Vendor payment not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendor payment: " + error.message });
  }
};
