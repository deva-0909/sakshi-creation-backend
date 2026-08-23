// Module 12/13: PDF generation. pdfkit draws documents programmatically
// (text/tables/lines) rather than rendering HTML through a headless
// browser -- chosen per the user's decision for reliability on Vercel's
// serverless functions (no Chromium bundle needed). Every builder returns
// a PDFDocument that the caller pipes directly to the HTTP response, so
// nothing is buffered in memory or written to disk.
const PDFDocument = require("pdfkit");
const supabase = require("../lib/supabaseClient");

async function getCompanyLegalName() {
  const { data } = await supabase.from("app_settings").select("setting_value").eq("setting_key", "company_legal_name").maybeSingle();
  return data?.setting_value || "Sakshi Creation";
}

function drawHeader(doc, title, docNumber, companyName) {
  doc.fontSize(18).font("Helvetica-Bold").text(companyName, { align: "left" });
  doc.moveDown(0.2);
  doc.fontSize(14).font("Helvetica-Bold").text(title, { align: "left" });
  doc.fontSize(10).font("Helvetica").text(`No: ${docNumber}`, { align: "left" });
  doc.moveDown(0.5);
  doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cccccc").stroke();
  doc.moveDown(0.8);
}

function drawKeyValueRow(doc, label, value) {
  if (value === undefined || value === null || value === "") return;
  doc.fontSize(10).font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(String(value));
}

function drawTable(doc, headers, rows, colWidths) {
  const startX = doc.x;
  let y = doc.y;
  doc.fontSize(9).font("Helvetica-Bold");
  let x = startX;
  headers.forEach((h, i) => {
    doc.text(h, x, y, { width: colWidths[i], continued: false });
    x += colWidths[i];
  });
  y += 16;
  doc.moveTo(startX, y - 3).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y - 3).strokeColor("#cccccc").stroke();
  doc.font("Helvetica").fontSize(9);
  rows.forEach((row) => {
    x = startX;
    row.forEach((cell, i) => {
      doc.text(String(cell ?? "-"), x, y, { width: colWidths[i] });
      x += colWidths[i];
    });
    y += 16;
  });
  doc.y = y + 8;
}

async function buildQuotationPdf(quotation) {
  const companyName = await getCompanyLegalName();
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  drawHeader(doc, "QUOTATION", quotation.quotationNumber, companyName);

  drawKeyValueRow(doc, "Party", quotation.party?.partyName);
  drawKeyValueRow(doc, "Company", quotation.companyName?.companyName);
  drawKeyValueRow(doc, "Product", quotation.productItem?.itemName);
  drawKeyValueRow(doc, "Valid Until", quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString() : null);
  drawKeyValueRow(doc, "Status", quotation.status);
  doc.moveDown(0.8);

  drawTable(
    doc,
    ["Qty", "Size", "Rate", "Rate Type", "GST %", "Total Amount"],
    [[quotation.qty, quotation.size || "-", quotation.rate, quotation.rateType || "-", quotation.gstPercentage ?? "-", quotation.totalAmount ?? "-"]],
    [70, 90, 80, 80, 70, 100]
  );

  if (quotation.specs) {
    doc.moveDown(0.5).fontSize(10).font("Helvetica-Bold").text("Specifications:");
    doc.font("Helvetica").text(quotation.specs);
  }
  if (quotation.remarks) {
    doc.moveDown(0.5).fontSize(10).font("Helvetica-Bold").text("Remarks:");
    doc.font("Helvetica").text(quotation.remarks);
  }

  return doc;
}

async function buildInvoicePdf(invoice, items) {
  const companyName = await getCompanyLegalName();
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  drawHeader(doc, "TAX INVOICE", invoice.invoiceNumber, companyName);

  drawKeyValueRow(doc, "Party", invoice.party?.partyName);
  drawKeyValueRow(doc, "Party GST No", invoice.party?.gstNo);
  drawKeyValueRow(doc, "Company", invoice.companyName?.companyName);
  drawKeyValueRow(doc, "Invoice Date", invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : null);
  drawKeyValueRow(doc, "Due Date", invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : null);
  drawKeyValueRow(doc, "GST Type", invoice.gstType);
  drawKeyValueRow(doc, "Status", invoice.status);
  doc.moveDown(0.8);

  drawTable(
    doc,
    ["Description", "HSN", "Qty", "Unit Price", "GST %", "Taxable Amt", "Line Total"],
    (items || []).map((it) => [it.description, it.hsnCode || "-", it.quantity, it.unitPrice, it.gstRate, it.taxableAmount, it.lineTotal]),
    [110, 50, 40, 70, 50, 80, 80]
  );

  doc.moveDown(0.5);
  drawKeyValueRow(doc, "Subtotal", invoice.subtotal);
  if (invoice.cgstAmount) drawKeyValueRow(doc, "CGST", invoice.cgstAmount);
  if (invoice.sgstAmount) drawKeyValueRow(doc, "SGST", invoice.sgstAmount);
  if (invoice.igstAmount) drawKeyValueRow(doc, "IGST", invoice.igstAmount);
  doc.fontSize(11).font("Helvetica-Bold").text(`Grand Total: ${invoice.grandTotal}`);
  drawKeyValueRow(doc, "Amount Paid", invoice.amountPaid);

  if (invoice.notes) {
    doc.moveDown(0.5).fontSize(10).font("Helvetica-Bold").text("Notes:");
    doc.font("Helvetica").text(invoice.notes);
  }

  return doc;
}

async function buildDeliveryChallanPdf(challan) {
  const companyName = await getCompanyLegalName();
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  drawHeader(doc, "DELIVERY CHALLAN", challan.challanNumber, companyName);

  drawKeyValueRow(doc, "Order No", challan.order?.orderNumber);
  drawKeyValueRow(doc, "Customer PO No", challan.order?.customerPoNumber);
  drawKeyValueRow(doc, "Party", challan.party?.partyName);
  drawKeyValueRow(doc, "Company", challan.companyName?.companyName);
  drawKeyValueRow(doc, "Delivery Date", challan.deliveryDate ? new Date(challan.deliveryDate).toLocaleDateString() : null);
  drawKeyValueRow(doc, "Status", challan.status);
  doc.moveDown(0.8);

  drawTable(doc, ["Quantity Delivered"], [[challan.quantityDelivered]], [150]);
  doc.moveDown(0.5);

  doc.fontSize(11).font("Helvetica-Bold").text("Vehicle & Package Details");
  doc.moveDown(0.2);
  drawKeyValueRow(doc, "Vehicle Number", challan.vehicleNumber);
  drawKeyValueRow(doc, "Vehicle Type", challan.vehicleType);
  drawKeyValueRow(doc, "Driver Name", challan.driverName);
  drawKeyValueRow(doc, "Driver Contact", challan.driverContact);
  drawKeyValueRow(doc, "Package Count", challan.packageCount);
  drawKeyValueRow(doc, "Package Weight", challan.packageWeight);

  if (challan.status === "Delivered") {
    doc.moveDown(0.8);
    doc.fontSize(11).font("Helvetica-Bold").text("Proof of Delivery");
    doc.moveDown(0.2);
    drawKeyValueRow(doc, "Received By", challan.podReceivedBy);
    drawKeyValueRow(doc, "Designation", challan.podDesignation);
    drawKeyValueRow(doc, "Received At", challan.podReceivedAt ? new Date(challan.podReceivedAt).toLocaleString() : null);
    if (challan.podNotes) {
      doc.moveDown(0.3).fontSize(10).font("Helvetica-Bold").text("Notes:");
      doc.font("Helvetica").text(challan.podNotes);
    }
  }

  if (challan.notes) {
    doc.moveDown(0.5).fontSize(10).font("Helvetica-Bold").text("Notes:");
    doc.font("Helvetica").text(challan.notes);
  }

  doc.moveDown(1.5);
  doc.fontSize(9).font("Helvetica").text("Received in good condition:", { align: "left" });
  doc.moveDown(2);
  doc.text("_______________________", { align: "left" });
  doc.text("Signature", { align: "left" });

  return doc;
}

function streamPdf(res, doc, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  doc.pipe(res);
  doc.end();
}

module.exports = { buildQuotationPdf, buildInvoicePdf, buildDeliveryChallanPdf, streamPdf };
