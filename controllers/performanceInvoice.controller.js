const supabase = require("../lib/supabaseClient");
const { isValidId } = require("../lib/helpers");

const SELECT = `
  id, orderNumber:order_number, quantity, color, size, pType:p_type, GSTNo:gst_no, partyAddress:party_address,
  servicePerformance:service_performance, unitPrice:unit_price, total, applyGST:apply_gst, gstPercentage:gst_percentage,
  finalAmount:final_amount, daysAfterConfirmation:days_after_confirmation, paymentTerms:payment_terms, signature,
  createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, name:company_name),
  party:party_id(id, partyName:party_name, GSTNo:gst_no, address),
  order:order_id(id, orderNumber:order_number),
  assignedTo:assigned_to(id, firstName:first_name, lastName:last_name)
`;

exports.createPerformanceInvoice = async (req, res) => {
  try {
    const {
      orderNumber, companyName, partyName, quantity, color, size, pType, assignedTo,
      unitPrice, applyGST, gstPercentage, GSTNo, partyAddress, servicePerformance,
      daysAfterConfirmation, paymentTerms, signature,
    } = req.body;

    if (!orderNumber || !companyName || !partyName || !quantity || !servicePerformance) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: orderNumber, companyName, partyName, quantity, or servicePerformance",
      });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, party:party_id(gst_no, address), productItem:product_item_id(item_name)")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (!order) {
      return res.status(400).json({ success: false, message: "Invalid order number" });
    }
    const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(400).json({ success: false, message: "Invalid companyName ID" });
    }
    const { data: party } = await supabase.from("parties").select("id").eq("id", partyName).maybeSingle();
    if (!party) {
      return res.status(400).json({ success: false, message: "Invalid partyName ID" });
    }

    const calculatedTotal = quantity * (unitPrice || 0);
    const calculatedFinalAmount = applyGST ? calculatedTotal * (1 + (gstPercentage || 0) / 100) : calculatedTotal;

    const { data: inserted, error } = await supabase
      .from("performance_invoices")
      .insert({
        order_number: orderNumber,
        order_id: order.id,
        company_name_id: companyName,
        party_id: partyName,
        assigned_to: assignedTo || null,
        quantity,
        color: color || "",
        size: size || "",
        p_type: pType || "",
        unit_price: unitPrice,
        total: calculatedTotal,
        apply_gst: applyGST || false,
        gst_percentage: gstPercentage || 0,
        final_amount: calculatedFinalAmount,
        gst_no: GSTNo || order.party?.gst_no || "",
        party_address: partyAddress || order.party?.address || {},
        service_performance: servicePerformance || order.productItem?.item_name || "",
        days_after_confirmation: daysAfterConfirmation || null,
        payment_terms: paymentTerms || "",
        signature: signature || "",
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: populated } = await supabase.from("performance_invoices").select(SELECT).eq("id", inserted.id).single();

    res.status(201).json({ success: true, message: "Performance invoice created successfully", data: { ...populated, _id: populated.id } });
  } catch (error) {
    console.error("Error creating performance invoice:", error);
    res.status(500).json({ success: false, message: "Failed to create performance invoice", error: error.message });
  }
};

exports.getAllPerformanceInvoices = async (req, res) => {
  try {
    const { data, error } = await supabase.from("performance_invoices").select(SELECT).order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: data.map((d) => ({ ...d, _id: d.id })) });
  } catch (error) {
    console.error("Error getting performance invoices:", error);
    res.status(500).json({ success: false, message: "Failed to fetch performance invoices", error: error.message });
  }
};

exports.getPerformanceInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid PerformanceInvoice ID" });
    }
    const { data: pi, error } = await supabase.from("performance_invoices").select(SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!pi) {
      return res.status(404).json({ success: false, message: "Performance invoice not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        _id: pi.id,
        orderNumber: pi.orderNumber,
        companyName: pi.companyName?.id,
        partyName: pi.party?.id,
        quantity: pi.quantity,
        color: pi.color,
        size: pi.size,
        pType: pi.pType,
        GSTNo: pi.GSTNo,
        partyAddress: pi.partyAddress,
        servicePerformance: pi.servicePerformance,
        unitPrice: pi.unitPrice || 0,
        total: pi.total || 0,
        applyGST: pi.applyGST || false,
        finalAmount: pi.finalAmount || 0,
        assignedTo: pi.assignedTo,
        companyNameObj: pi.companyName,
        partyObj: pi.party,
        paymentTerms: pi.paymentTerms || "",
        signature: pi.signature || "",
      },
    });
  } catch (error) {
    console.error("Error fetching performance invoice:", error);
    res.status(500).json({ success: false, message: "Failed to fetch performance invoice", error: error.message });
  }
};

exports.updatePerformanceInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      orderNumber, companyName, partyName, quantity, color, size, pType, assignedTo,
      unitPrice, applyGST, gstPercentage, GSTNo, partyAddress, servicePerformance,
      daysAfterConfirmation, paymentTerms, signature,
    } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid PerformanceInvoice ID" });
    }
    const { data: existing } = await supabase.from("performance_invoices").select("*").eq("id", id).maybeSingle();
    if (!existing) {
      return res.status(400).json({ success: false, message: "Performance invoice not found" });
    }
    if (!orderNumber || !companyName || !partyName || !quantity || !servicePerformance) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: orderNumber, companyName, partyName, quantity, or servicePerformance",
      });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, party:party_id(gst_no, address)")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (!order) {
      return res.status(400).json({ success: false, message: "Invalid order number" });
    }
    const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(400).json({ success: false, message: "Invalid companyName ID" });
    }
    const { data: party } = await supabase.from("parties").select("id").eq("id", partyName).maybeSingle();
    if (!party) {
      return res.status(400).json({ success: false, message: "Invalid partyName ID" });
    }

    const calculatedTotal = quantity * (unitPrice || 0);
    const calculatedFinalAmount = applyGST ? calculatedTotal * (1 + (gstPercentage || 0) / 100) : calculatedTotal;

    const { error } = await supabase
      .from("performance_invoices")
      .update({
        order_number: orderNumber,
        order_id: order.id,
        company_name_id: companyName,
        party_id: partyName,
        quantity,
        color,
        assigned_to: assignedTo || null,
        size,
        p_type: pType,
        unit_price: unitPrice,
        total: calculatedTotal,
        apply_gst: applyGST || false,
        gst_percentage: gstPercentage || 0,
        final_amount: calculatedFinalAmount,
        gst_no: GSTNo || order.party?.gst_no || "",
        party_address: partyAddress || order.party?.address || {},
        service_performance: servicePerformance,
        days_after_confirmation: daysAfterConfirmation,
        payment_terms: paymentTerms || existing.payment_terms || "",
        signature: signature || existing.signature || "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;

    const { data: populated } = await supabase.from("performance_invoices").select(SELECT).eq("id", id).single();

    res.status(200).json({ success: true, message: "Performance invoice updated successfully", data: { ...populated, _id: populated.id } });
  } catch (error) {
    console.error("Error updating performance invoice:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deletePerformanceInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid PerformanceInvoice ID" });
    }
    const { data, error } = await supabase.from("performance_invoices").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Performance invoice not found" });
    }
    res.status(200).json({ success: true, message: "Performance invoice deleted successfully" });
  } catch (error) {
    console.error("Error deleting performance invoice:", error);
    res.status(500).json({ success: false, message: "Failed to delete performance invoice", error: error.message });
  }
};
