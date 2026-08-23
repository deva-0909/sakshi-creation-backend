const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");

const JOB_CARD_SELECT = `
  id, jobCardNumber:job_card_number, qty, status, createdAt:created_at,
  order:order_id(id, orderNumber:order_number)
`;

// Same "most recent purchases.rate_per_sheet per material" lookup
// bom.controller.js's estimateCost already uses -- kept identical so
// Costing and the BOM cost estimate never silently disagree about where a
// material's cost comes from. Returns null (rather than 0) when a
// material has no purchase history, so the caller can flag the line as
// missing rate data instead of showing a wrong zero.
async function latestRate(materialId) {
  const { data } = await supabase
    .from("purchases")
    .select("rate_per_sheet")
    .eq("material_id", materialId)
    .eq("is_delete", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.rate_per_sheet ?? null;
}

// Computed live from current data on every call -- deliberately not
// stored, the same choice made for Stock Ledger (Module 2), so there is
// no second, driftable source of truth for a job's cost/profit.
//
// Module 14: extended from 3 cost buckets (material/labor/overhead) to
// all 8 the scope doc asks for (+printing/binding/finishing/outsourcing/
// delivery), per the user's explicit choice of "all 8" over the smaller
// 7-bucket option offered. The 5 new buckets are manually entered on
// job_card_costs (upsertJobCardCosts) exactly like labor/overhead already
// were -- no new source of truth exists for them either.
async function computeCosting(jobCard) {
  const { data: usageRows } = await supabase
    .from("job_card_material_usage")
    .select("id, quantityUsed:quantity_used, material:material_id(id, materialName:material_name)")
    .eq("job_card_id", jobCard.id);

  const materialLines = await Promise.all(
    (usageRows || []).map(async (u) => {
      const rate = await latestRate(u.material.id);
      const qty = Number(u.quantityUsed);
      return {
        material: u.material,
        quantityUsed: qty,
        rate,
        lineCost: rate !== null ? Number((rate * qty).toFixed(2)) : null,
      };
    })
  );
  const hasFullMaterialRateData = materialLines.length > 0 && materialLines.every((l) => l.lineCost !== null);
  const materialCost = Number(materialLines.reduce((sum, l) => sum + (l.lineCost || 0), 0).toFixed(2));

  const { data: costRow } = await supabase
    .from("job_card_costs")
    .select(
      "laborCost:labor_cost, overheadCost:overhead_cost, printingCost:printing_cost, bindingCost:binding_cost, finishingCost:finishing_cost, outsourcingCost:outsourcing_cost, deliveryCost:delivery_cost, notes"
    )
    .eq("job_card_id", jobCard.id)
    .maybeSingle();
  const laborCost = Number(costRow?.laborCost || 0);
  const overheadCost = Number(costRow?.overheadCost || 0);
  const printingCost = Number(costRow?.printingCost || 0);
  const bindingCost = Number(costRow?.bindingCost || 0);
  const finishingCost = Number(costRow?.finishingCost || 0);
  const outsourcingCost = Number(costRow?.outsourcingCost || 0);
  const deliveryCost = Number(costRow?.deliveryCost || 0);

  const totalCost = Number(
    (materialCost + laborCost + overheadCost + printingCost + bindingCost + finishingCost + outsourcingCost + deliveryCost).toFixed(2)
  );

  // Revenue comes from Invoice.grand_total via the two-hop
  // job_card.order_id -> orders.id <- invoices.order_id join -- the
  // simplest reliable path (quotation_id is a separate, independently
  // nullable link on invoices, not reliably chained through quotations).
  let revenue = 0;
  if (jobCard.order?.id) {
    const { data: invoices } = await supabase
      .from("invoices")
      .select("grand_total")
      .eq("order_id", jobCard.order.id)
      .eq("is_delete", false)
      .neq("status", "Cancelled");
    revenue = Number((invoices || []).reduce((sum, inv) => sum + Number(inv.grand_total), 0).toFixed(2));
  }

  // Estimated cost = the linked Quotation's own costed total, when one
  // exists for this job card's order (per the user's explicit choice).
  // quotations.order_id is only ever populated once a quotation converts
  // to an order, so at most one quotation can match; most recent wins if
  // more than one somehow does.
  let estimatedCost = null;
  let costVariance = null;
  if (jobCard.order?.id) {
    const { data: quotation } = await supabase
      .from("quotations")
      .select("totalAmount:total_amount")
      .eq("order_id", jobCard.order.id)
      .eq("is_delete", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (quotation?.totalAmount !== null && quotation?.totalAmount !== undefined) {
      estimatedCost = Number(quotation.totalAmount);
      // Positive = actual cost ran over the quotation's costed total.
      costVariance = Number((totalCost - estimatedCost).toFixed(2));
    }
  }

  const profit = Number((revenue - totalCost).toFixed(2));
  const marginPct = revenue > 0 ? Number(((profit / revenue) * 100).toFixed(2)) : null;

  return {
    materialCost,
    hasFullMaterialRateData,
    laborCost,
    overheadCost,
    printingCost,
    bindingCost,
    finishingCost,
    outsourcingCost,
    deliveryCost,
    totalCost,
    estimatedCost,
    costVariance,
    revenue,
    profit,
    marginPct,
    notes: costRow?.notes || null,
    materialLines,
  };
}

// Exported so dashboard.controller.js can reuse the exact same
// computation for the profitability roll-up widget rather than
// duplicating the material/labor/overhead/revenue logic.
exports.computeCosting = computeCosting;

exports.getAllCosting = async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("job_cards").select(JOB_CARD_SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) query = query.ilike("job_card_number", `%${String(search).trim()}%`);

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 10;
      from = (pageNum - 1) * limitNum;
      query = query.range(from, from + limitNum - 1);
    }

    const { data: jobCards, error, count } = await query;
    if (error) throw error;

    // Summary rows omit the per-material line breakdown (kept for the
    // detail endpoint only) to keep the list payload reasonably sized.
    const rows = await Promise.all(
      (jobCards || []).map(async (jc) => {
        const { materialLines, ...costing } = await computeCosting(jc);
        return { ...jc, ...costing };
      })
    );

    const response = { success: true, count: rows.length, data: withMongoId(rows) };
    if (paginate) {
      response.pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalCount: count,
        hasNext: from + rows.length < count,
        hasPrev: pageNum > 1,
      };
    }
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching costing summary: " + error.message });
  }
};

exports.getCostingByJobCard = async (req, res) => {
  try {
    const { jobCardId } = req.params;
    if (!isValidId(jobCardId)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data: jobCard } = await supabase.from("job_cards").select(JOB_CARD_SELECT).eq("id", jobCardId).eq("is_delete", false).maybeSingle();
    if (!jobCard) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }
    const costing = await computeCosting(jobCard);
    res.status(200).json({ success: true, data: withMongoId({ ...jobCard, ...costing }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error computing job card costing: " + error.message });
  }
};

// Manual cost-bucket entry -- upserts the one job_card_costs row per job
// card. No wage/rate data exists anywhere in the system (confirmed during
// design research), so this is recorded by hand rather than derived, per
// the user's decision. Module 14 extended this from 2 buckets (labor/
// overhead) to all 8; kept as the same endpoint/export name
// (upsertLaborCost) since existing callers sending only laborCost/
// overheadCost keep working unchanged -- the 5 new fields are just
// additional optional body keys.
exports.upsertLaborCost = async (req, res) => {
  try {
    const { jobCardId } = req.params;
    if (!isValidId(jobCardId)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data: jobCard } = await supabase.from("job_cards").select("id").eq("id", jobCardId).eq("is_delete", false).maybeSingle();
    if (!jobCard) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }

    const { laborCost, overheadCost, printingCost, bindingCost, finishingCost, outsourcingCost, deliveryCost, notes } = req.body;
    const { data: existing } = await supabase.from("job_card_costs").select("id").eq("job_card_id", jobCardId).maybeSingle();

    let result;
    if (existing) {
      const payload = {
        ...(laborCost !== undefined && { labor_cost: Number(laborCost) }),
        ...(overheadCost !== undefined && { overhead_cost: Number(overheadCost) }),
        ...(printingCost !== undefined && { printing_cost: Number(printingCost) }),
        ...(bindingCost !== undefined && { binding_cost: Number(bindingCost) }),
        ...(finishingCost !== undefined && { finishing_cost: Number(finishingCost) }),
        ...(outsourcingCost !== undefined && { outsourcing_cost: Number(outsourcingCost) }),
        ...(deliveryCost !== undefined && { delivery_cost: Number(deliveryCost) }),
        ...(notes !== undefined && { notes }),
        updated_by: req.user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from("job_card_costs").update(payload).eq("id", existing.id).select("*").single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from("job_card_costs")
        .insert({
          job_card_id: jobCardId,
          labor_cost: laborCost !== undefined ? Number(laborCost) : 0,
          overhead_cost: overheadCost !== undefined ? Number(overheadCost) : 0,
          printing_cost: printingCost !== undefined ? Number(printingCost) : 0,
          binding_cost: bindingCost !== undefined ? Number(bindingCost) : 0,
          finishing_cost: finishingCost !== undefined ? Number(finishingCost) : 0,
          outsourcing_cost: outsourcingCost !== undefined ? Number(outsourcingCost) : 0,
          delivery_cost: deliveryCost !== undefined ? Number(deliveryCost) : 0,
          notes: notes || null,
          created_by: req.user?.id || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      result = data;
    }

    res.status(200).json({ success: true, message: "Job card costs saved", data: withMongoId(result) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error saving job card costs: " + error.message });
  }
};
