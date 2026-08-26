// Module 9: receivables/payables ledgers and ageing. Computed live from the
// existing source tables, never a second table kept in sync -- same
// architecture as the Stock Ledger (Module 2, stockLedger.controller.js).
//
// Payables debit-side design decision (documented here since it isn't
// enforced by a constraint anywhere): a vendor's ledger includes both
// - purchase_orders in Sent/Partially Received/Received, valued at
//   sum(quantity_ordered * rate) from purchase_order_items (POs carry no
//   stored grand_total), and
// - purchases rows (the older flat intake flow, which has no PO concept
//   and no amount column), valued as quantity * rate_per_sheet per the
//   confirmed design decision (Module 9 Q2: "compute implied amount").
// These are two independent intake paths in this codebase, not a
// PO-then-purchases pipeline, so there's no double-counting between them.
//
// Payables ageing buckets by transaction/creation date rather than a true
// due-date, since purchase_orders/purchases have no payment-terms/due-date
// field yet (that's Module 11 scope) -- a scoped simplification.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");

const AGEING_BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"];

function bucketForDays(days) {
  if (days <= 0) return "Current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function daysBetween(from, to) {
  const ms = new Date(to).setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86400000);
}

exports.getCustomerLedger = async (req, res) => {
  try {
    const { partyId } = req.params;
    const { from, to } = req.query;
    if (!isValidId(partyId)) {
      return res.status(400).json({ success: false, message: "Invalid party ID" });
    }

    const { data: party } = await supabase
      .from("parties")
      .select("id, partyName:party_name, creditLimit:credit_limit")
      .eq("id", partyId)
      .eq("is_delete", false)
      .maybeSingle();
    if (!party) {
      return res.status(404).json({ success: false, message: "Party not found" });
    }

    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("id, invoiceNumber:invoice_number, invoiceDate:invoice_date, grandTotal:grand_total, amountPaid:amount_paid, status")
      .eq("party_id", partyId)
      .eq("is_delete", false)
      .in("status", ["Issued", "Partially Paid", "Paid"]);
    if (invErr) throw invErr;

    const { data: receipts, error: rcptErr } = await supabase
      .from("receipts")
      .select("id, receiptNumber:receipt_number, paymentDate:payment_date, amount")
      .eq("party_id", partyId)
      .eq("is_delete", false);
    if (rcptErr) throw rcptErr;

    const { data: creditNotes, error: cnErr } = await supabase
      .from("credit_notes")
      .select("id, creditNoteNumber:credit_note_number, issuedAt:issued_at, amount")
      .eq("party_id", partyId)
      .eq("is_delete", false)
      .eq("status", "Issued");
    if (cnErr) throw cnErr;

    let lines = [
      ...(invoices || []).map((i) => ({ date: i.invoiceDate, type: "Invoice", reference: i.invoiceNumber, debit: Number(i.grandTotal), credit: 0, refId: i.id })),
      ...(receipts || []).map((r) => ({ date: r.paymentDate, type: "Receipt", reference: r.receiptNumber, debit: 0, credit: Number(r.amount), refId: r.id })),
      ...(creditNotes || []).map((c) => ({ date: (c.issuedAt || "").slice(0, 10), type: "Credit Note", reference: c.creditNoteNumber, debit: 0, credit: Number(c.amount), refId: c.id })),
    ];
    if (from) lines = lines.filter((l) => l.date >= from);
    if (to) lines = lines.filter((l) => l.date <= to);
    lines.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

    let runningBalance = 0;
    const rows = lines.map((l) => {
      runningBalance += l.debit - l.credit;
      return { ...l, runningBalance };
    });

    const outstandingBalance = (invoices || []).reduce((sum, i) => sum + (Number(i.grandTotal) - Number(i.amountPaid)), 0);
    const creditLimit = party.creditLimit != null ? Number(party.creditLimit) : null;

    res.status(200).json({
      success: true,
      data: {
        party: withMongoId(party),
        outstandingBalance,
        creditLimit,
        overCreditLimit: creditLimit != null && outstandingBalance > creditLimit,
        closingBalance: runningBalance,
        rows: withMongoId(rows),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching customer ledger: " + error.message });
  }
};

exports.getCustomerAgeing = async (req, res) => {
  try {
    const { partyId, companyName } = req.query;
    if (partyId && !isValidId(partyId)) {
      return res.status(400).json({ success: false, message: "Invalid party ID" });
    }

    let query = supabase
      .from("invoices")
      .select("id, invoiceNumber:invoice_number, invoiceDate:invoice_date, dueDate:due_date, grandTotal:grand_total, amountPaid:amount_paid, party:party_id(id, partyName:party_name)")
      .eq("is_delete", false)
      .in("status", ["Issued", "Partially Paid"]);
    if (partyId) query = query.eq("party_id", partyId);
    if (companyName) query = query.eq("company_name_id", companyName);

    const { data, error } = await query;
    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);
    const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0]));
    const rows = (data || []).map((i) => {
      const outstanding = Number(i.grandTotal) - Number(i.amountPaid);
      const dueDate = i.dueDate || i.invoiceDate;
      const days = daysBetween(dueDate, today);
      const bucket = bucketForDays(days);
      buckets[bucket] += outstanding;
      return { ...i, outstanding, daysOverdue: days, bucket };
    });

    res.status(200).json({ success: true, data: { buckets, rows: withMongoId(rows) } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching customer ageing: " + error.message });
  }
};

exports.getVendorLedger = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { from, to } = req.query;
    if (!isValidId(vendorId)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name, creditLimit:credit_limit")
      .eq("id", vendorId)
      .eq("is_delete", false)
      .maybeSingle();
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    const { data: pos, error: poErr } = await supabase
      .from("purchase_orders")
      .select("id, poNumber:po_number, createdAt:created_at, status, items:purchase_order_items(quantityOrdered:quantity_ordered, rate)")
      .eq("vendor_id", vendorId)
      .eq("is_delete", false)
      .in("status", ["Sent", "Partially Received", "Received"]);
    if (poErr) throw poErr;

    const { data: purchases, error: purErr } = await supabase
      .from("purchases")
      .select("id, billNumber:bill_number, createdAt:created_at, quantity, ratePerSheet:rate_per_sheet")
      .eq("vendor_name_id", vendorId)
      .eq("is_delete", false);
    if (purErr) throw purErr;

    const { data: payments, error: payErr } = await supabase
      .from("vendor_payments")
      .select("id, paymentNumber:payment_number, paymentDate:payment_date, amount")
      .eq("vendor_id", vendorId)
      .eq("is_delete", false);
    if (payErr) throw payErr;

    const { data: debitNotes, error: dnErr } = await supabase
      .from("debit_notes")
      .select("id, debitNoteNumber:debit_note_number, issuedAt:issued_at, amount")
      .eq("vendor_id", vendorId)
      .eq("is_delete", false)
      .eq("status", "Issued");
    if (dnErr) throw dnErr;

    let lines = [
      ...(pos || []).map((po) => ({
        date: (po.createdAt || "").slice(0, 10),
        type: "Purchase Order",
        reference: po.poNumber,
        debit: (po.items || []).reduce((sum, it) => sum + Number(it.quantityOrdered) * Number(it.rate), 0),
        credit: 0,
        refId: po.id,
      })),
      ...(purchases || []).map((p) => ({
        date: (p.createdAt || "").slice(0, 10),
        type: "Purchase",
        reference: p.billNumber || "-",
        debit: Number(p.quantity || 0) * Number(p.ratePerSheet || 0),
        credit: 0,
        refId: p.id,
      })),
      ...(payments || []).map((pay) => ({ date: pay.paymentDate, type: "Payment", reference: pay.paymentNumber, debit: 0, credit: Number(pay.amount), refId: pay.id })),
      ...(debitNotes || []).map((d) => ({ date: (d.issuedAt || "").slice(0, 10), type: "Debit Note", reference: d.debitNoteNumber, debit: 0, credit: Number(d.amount), refId: d.id })),
    ];
    if (from) lines = lines.filter((l) => l.date >= from);
    if (to) lines = lines.filter((l) => l.date <= to);
    lines.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

    let runningBalance = 0;
    const rows = lines.map((l) => {
      runningBalance += l.debit - l.credit;
      return { ...l, runningBalance };
    });

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
    const outstandingBalance = totalDebit - totalCredit;
    const creditLimit = vendor.creditLimit != null ? Number(vendor.creditLimit) : null;

    res.status(200).json({
      success: true,
      data: {
        vendor: withMongoId(vendor),
        outstandingBalance,
        creditLimit,
        overCreditLimit: creditLimit != null && outstandingBalance > creditLimit,
        closingBalance: runningBalance,
        rows: withMongoId(rows),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendor ledger: " + error.message });
  }
};

exports.getVendorAgeing = async (req, res) => {
  try {
    const { vendorId, companyName } = req.query;
    if (vendorId && !isValidId(vendorId)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }

    let poQuery = supabase
      .from("purchase_orders")
      .select("id, poNumber:po_number, createdAt:created_at, vendor:vendor_id(id, name), items:purchase_order_items(quantityOrdered:quantity_ordered, rate)")
      .eq("is_delete", false)
      .in("status", ["Sent", "Partially Received", "Received"]);
    if (vendorId) poQuery = poQuery.eq("vendor_id", vendorId);
    if (companyName) poQuery = poQuery.eq("company_name_id", companyName);
    const { data: pos, error: poErr } = await poQuery;
    if (poErr) throw poErr;

    let purQuery = supabase.from("purchases").select("id, billNumber:bill_number, createdAt:created_at, quantity, ratePerSheet:rate_per_sheet, vendorNameId:vendor_name_id").eq("is_delete", false);
    if (vendorId) purQuery = purQuery.eq("vendor_name_id", vendorId);
    if (companyName) purQuery = purQuery.eq("company_name_id", companyName);
    const { data: purchases, error: purErr } = await purQuery;
    if (purErr) throw purErr;

    // Bug found during Module 16 triage (audit-reconciliation.md's carried-forward
    // "unverified data-integrity concern" in ledger/ageing logic): this endpoint
    // used to bucket each PO's full gross value by age with no regard for
    // payments already recorded against it, so a fully-paid-off PO kept
    // inflating payables ageing forever (purchase_orders has no "Paid" status --
    // Sent/Partially Received/Received track goods receipt, not payment).
    // Vendor payments settle a PO one of two ways -- a direct single-PO payment
    // (vendor_payments.purchase_order_id) or a split across several POs
    // (vendor_payment_allocations, one row per PO) -- so both are summed and
    // netted off the PO's gross amount here, matching how getVendorLedger's
    // running balance already accounts for the same payments in aggregate.
    // Plain `purchases` rows (the pre-PO flat intake path) have no equivalent
    // per-record payment link anywhere in the schema, so they can't be netted
    // the same way -- same documented structural limitation as the payables
    // ageing bucketing-by-creation-date decision above.
    const poIds = (pos || []).map((po) => po.id);
    const paidByPo = {};
    if (poIds.length) {
      const { data: directPayments, error: dpErr } = await supabase
        .from("vendor_payments")
        .select("purchaseOrderId:purchase_order_id, amount")
        .in("purchase_order_id", poIds)
        .eq("is_delete", false);
      if (dpErr) throw dpErr;
      (directPayments || []).forEach((p) => {
        paidByPo[p.purchaseOrderId] = (paidByPo[p.purchaseOrderId] || 0) + Number(p.amount);
      });

      const { data: allocations, error: allocErr } = await supabase
        .from("vendor_payment_allocations")
        .select("purchaseOrderId:purchase_order_id, amountAllocated:amount_allocated")
        .in("purchase_order_id", poIds);
      if (allocErr) throw allocErr;
      (allocations || []).forEach((a) => {
        paidByPo[a.purchaseOrderId] = (paidByPo[a.purchaseOrderId] || 0) + Number(a.amountAllocated);
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0]));

    const poRows = (pos || [])
      .map((po) => {
        const gross = (po.items || []).reduce((sum, it) => sum + Number(it.quantityOrdered) * Number(it.rate), 0);
        const amount = gross - (paidByPo[po.id] || 0);
        const date = (po.createdAt || "").slice(0, 10);
        const days = daysBetween(date, today);
        const bucket = bucketForDays(days);
        return { type: "Purchase Order", reference: po.poNumber, vendor: po.vendor, amount, daysOld: days, bucket };
      })
      // A PO paid off in full (or over-allocated) no longer belongs in payables ageing at all.
      .filter((row) => row.amount > 0);
    poRows.forEach((row) => {
      buckets[row.bucket] += row.amount;
    });

    const purRows = (purchases || []).map((p) => {
      const amount = Number(p.quantity || 0) * Number(p.ratePerSheet || 0);
      const date = (p.createdAt || "").slice(0, 10);
      const days = daysBetween(date, today);
      const bucket = bucketForDays(days);
      buckets[bucket] += amount;
      return { type: "Purchase", reference: p.billNumber || "-", amount, daysOld: days, bucket };
    });

    res.status(200).json({ success: true, data: { buckets, rows: withMongoId([...poRows, ...purRows]) } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendor ageing: " + error.message });
  }
};
