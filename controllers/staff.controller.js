const supabase = require("../lib/supabaseClient");
const jwt = require("jsonwebtoken");
const { isValidId, withMongoId, hashPassword, comparePassword, maskAadhar } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { logImport } = require("../lib/importLog");
const { Readable } = require("stream");
const csv = require("csv-parser");

// §77: the CSV template a bulk-import file must match.
const BULK_TEMPLATE_HEADERS = [
  "firstName", "lastName", "email", "mobileNo", "whatsappNo", "address",
  "aadharNo", "joiningDate", "birthDay", "password",
];

const SELECT_NO_PASSWORD = `
  id, firstName:first_name, lastName:last_name, email, mobileNo:mobile_no, whatsappNo:whatsapp_no,
  address, aadharNo:aadhar_no, joiningDate:joining_date, birthDay:birth_day, status,
  aadharFiles:aadhar_files, addressFiles:address_files, createdAt:created_at, updatedAt:updated_at,
  lastLoginAt:last_login_at,
  role:role_id(id, roleName:role_name, isDelete:is_delete, totalUser:total_user, permissions),
  CompanyName:company_name_id(id, companyName:company_name, avatar),
  branch:branch_id(id, branchName:branch_name),
  designation:designation_id(id, designationName:designation_name)
`;

exports.createStaff = async (req, res) => {
  try {
    const requiredFields = [
      "firstName", "lastName", "mobileNo", "whatsappNo", "address", "aadharNo",
      "joiningDate", "password", "role", "companyName", "aadharFiles",
    ];
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({ success: false, message: `Missing required field: ${field}` });
      }
    }

    let email = req.body.email;
    if (email) {
      email = email.toLowerCase();
      const { data: existingEmail } = await supabase.from("staff").select("id").eq("email", email).eq("is_delete", false).maybeSingle();
      if (existingEmail) {
        return res.status(400).json({ success: false, message: "Email already in use" });
      }
    }

    const aadharRegex = /^[0-9]{12}$/;
    if (!aadharRegex.test(req.body.aadharNo)) {
      return res.status(400).json({ success: false, message: "Invalid Aadhar number format. Must be 12 digits." });
    }

    const { data: existingAadhar } = await supabase.from("staff").select("id").eq("aadhar_no", req.body.aadharNo).eq("is_delete", false).maybeSingle();
    if (existingAadhar) {
      return res.status(400).json({ success: false, message: "Aadhar number already in use" });
    }

    if (!req.body.aadharFiles || !Array.isArray(req.body.aadharFiles) || req.body.aadharFiles.length === 0) {
      return res.status(400).json({ success: false, message: "At least one Aadhar file is required" });
    }

    const { data: roleExists } = await supabase.from("roles").select("id").eq("id", req.body.role).maybeSingle();
    if (!roleExists) {
      return res.status(400).json({ success: false, message: "Invalid role ID. No matching role found." });
    }

    if (!isValidId(req.body.companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID format." });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", req.body.companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: "Invalid company ID. No matching company found." });
    }

    const hashedPassword = await hashPassword(req.body.password);

    const { data: newStaff, error } = await supabase
      .from("staff")
      .insert({
        first_name: req.body.firstName,
        last_name: req.body.lastName,
        email: email || null,
        mobile_no: req.body.mobileNo,
        whatsapp_no: req.body.whatsappNo,
        address: req.body.address,
        aadhar_no: req.body.aadharNo,
        joining_date: req.body.joiningDate,
        birth_day: req.body.birthDay || null,
        company_name_id: req.body.companyName,
        password: hashedPassword,
        role_id: req.body.role,
        aadhar_files: req.body.aadharFiles,
        address_files: req.body.addressFiles || [],
        branch_id: req.body.branch || null,
        designation_id: req.body.designation || null,
        created_by: req.user?.id || null,
      })
      .select("id")
      .single();

    if (error) throw error;

    const { data: populatedStaff } = await supabase.from("staff").select(SELECT_NO_PASSWORD).eq("id", newStaff.id).single();

    await updateAllRoleUserCounts();

    // populatedStaff never includes the password (SELECT_NO_PASSWORD), so
    // it's safe to store as-is.
    logAudit({ req, action: "create", module: "staff", recordId: newStaff.id, newValue: populatedStaff });

    res.status(201).json({ success: true, message: "Staff member created successfully", data: withMongoId(populatedStaff) });
  } catch (error) {
    console.error("Error creating staff:", error);
    res.status(500).json({ success: false, message: "Failed to create staff member", error: error.message });
  }
};

exports.getStaff = async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("staff").select(SELECT_NO_PASSWORD, { count: "exact" }).eq("is_delete", false);

    if (search && String(search).trim()) {
      const s = String(search).trim();
      query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`);
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

    // Bulk listing — mask Aadhar here so one call can't enumerate every
    // staff member's full number. getStaffById still returns the full
    // number, since that's what the edit form needs.
    const masked = (data || []).map((row) => ({ ...row, aadharNo: maskAadhar(row.aadharNo) }));

    const response = { success: true, data: withMongoId(masked) };
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
    res.status(500).json({ success: false, message: error.message });
  }
};

// Tier 1 security audit fix (2026-09-01), Fix 3: lightweight companion to
// getStaff() above, for the many picker/dropdown call sites (AssignLeadDialog,
// opportunity dialog, party dialog, job-card/complaints/stock-movement/PO
// views, etc.) that only ever needed an id + a display name, never the full
// roster with role permissions and staff PII that getStaff() returns. Kept
// on authenticateToken only, same low bar as getStaff() had before this fix
// -- it's the safe alternative that lets /getall itself be locked down to
// setup.staff view_global without breaking every non-Admin role's dropdowns.
//
// Patch 127 correction: the original version of this endpoint omitted
// roleName entirely, but several of the dropdown consumers it was built for
// (AssignLeadDialog, AddNewPartyDialog, assigntaskdailog, opportunitydialog)
// filter the staff list down to `staff.roleName === "Sales Staff"` client
// side -- with no roleName in the response that filter always evaluates
// false, so those pickers would have silently rendered empty for every
// role. Joins role_id the same way SELECT_NO_PASSWORD above does, but
// selects only the one field (roleName) actually needed here -- still no
// permissions payload, so the "nothing sensitive" rationale below holds.
exports.getStaffLite = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("staff")
      .select("id, firstName:first_name, lastName:last_name, role:role_id(roleName:role_name)")
      .eq("is_delete", false);
    if (error) throw error;

    const lite = (data || []).map((row) => ({
      id: row.id,
      name: [row.firstName, row.lastName].filter(Boolean).join(" "),
      roleName: row.role?.roleName ?? null,
    }));
    res.status(200).json({ success: true, data: lite });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getStaffById = async (req, res) => {
  try {
    const { data, error } = await supabase.from("staff").select(SELECT_NO_PASSWORD).eq("id", req.params.id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    // §36: the edit form needs the full Aadhar number, but that's the
    // only legitimate reason to see it. Anyone with "setup.staff" edit
    // permission (the same permission that gates the edit form itself)
    // or viewing their own record gets the real number; everyone else
    // gets the same masked form used on the staff list.
    const permissions = req.user?.roleData?.permissions;
    const canEditStaff = !!(permissions && permissions["setup.staff"] && permissions["setup.staff"].edit === true);
    const isSelf = req.user?.id && String(req.user.id) === String(data.id);
    const result = canEditStaff || isSelf ? data : { ...data, aadharNo: maskAadhar(data.aadharNo) };

    res.status(200).json({ success: true, data: withMongoId(result) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateStaff = async (req, res) => {
  try {
    if (req.body.email) {
      const { data: existingStaff } = await supabase
        .from("staff")
        .select("id")
        .eq("email", req.body.email)
        .eq("is_delete", false)
        .neq("id", req.params.id)
        .maybeSingle();
      if (existingStaff) {
        return res.status(400).json({ success: false, message: "Email already in use by another staff member" });
      }
    }

    if (req.body.aadharNo) {
      const { data: existingAadhar } = await supabase
        .from("staff")
        .select("id")
        .eq("aadhar_no", req.body.aadharNo)
        .eq("is_delete", false)
        .neq("id", req.params.id)
        .maybeSingle();
      if (existingAadhar) {
        return res.status(400).json({ success: false, message: "Aadhar number already in use" });
      }
      if (!/^[0-9]{12}$/.test(req.body.aadharNo)) {
        return res.status(400).json({ success: false, message: "Invalid Aadhar number format. Must be 12 digits." });
      }
    }

    if (req.body.aadharFiles && (!Array.isArray(req.body.aadharFiles) || req.body.aadharFiles.length === 0)) {
      return res.status(400).json({ success: false, message: "At least one Aadhar file is required" });
    }

    if (req.body.role) {
      const { data: roleExists } = await supabase.from("roles").select("id").eq("id", req.body.role).maybeSingle();
      if (!roleExists) {
        return res.status(400).json({ success: false, message: "Invalid role ID. No matching role found." });
      }
    }

    const updateData = {
      ...(req.body.firstName && { first_name: req.body.firstName }),
      ...(req.body.lastName && { last_name: req.body.lastName }),
      ...(req.body.email && { email: req.body.email }),
      ...(req.body.mobileNo && { mobile_no: req.body.mobileNo }),
      ...(req.body.whatsappNo && { whatsapp_no: req.body.whatsappNo }),
      ...(req.body.address && { address: req.body.address }),
      ...(req.body.aadharNo && { aadhar_no: req.body.aadharNo }),
      ...(req.body.joiningDate && { joining_date: req.body.joiningDate }),
      ...(req.body.birthDay && { birth_day: req.body.birthDay }),
      ...(req.body.role && { role_id: req.body.role }),
      ...(req.body.companyName && { company_name_id: req.body.companyName }),
      ...(req.body.aadharFiles && { aadhar_files: req.body.aadharFiles }),
      ...(req.body.addressFiles && { address_files: req.body.addressFiles }),
      ...(req.body.status !== undefined && { status: req.body.status }),
      ...(req.body.branch !== undefined && { branch_id: req.body.branch || null }),
      ...(req.body.designation !== undefined && { designation_id: req.body.designation || null }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    if (req.body.password) {
      updateData.password = await hashPassword(req.body.password);
    }

    const { data: before } = await supabase.from("staff").select(SELECT_NO_PASSWORD).eq("id", req.params.id).maybeSingle();

    const { data: updatedStaff, error } = await supabase
      .from("staff")
      .update(updateData)
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!updatedStaff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    const { data: populated } = await supabase.from("staff").select(SELECT_NO_PASSWORD).eq("id", req.params.id).single();
    await updateAllRoleUserCounts();

    // Neither `before` nor `populated` ever includes the password
    // (SELECT_NO_PASSWORD), so it's safe to store as-is. A changed
    // password still shows up as an "update" action, just without the
    // value itself.
    logAudit({ req, action: "update", module: "staff", recordId: req.params.id, oldValue: before, newValue: populated });

    res.status(200).json({ success: true, message: "Staff member updated successfully", data: withMongoId(populated) });
  } catch (error) {
    console.error("Error updating staff:", error);
    res.status(500).json({ success: false, message: "Failed to update staff member", error: error.message });
  }
};

exports.updateStaffStatus = async (req, res) => {
  try {
    const { data: before } = await supabase.from("staff").select("status").eq("id", req.params.id).maybeSingle();

    const { data, error } = await supabase
      .from("staff")
      .update({ status: req.body.status })
      .eq("id", req.params.id)
      .select(SELECT_NO_PASSWORD)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    logAudit({
      req,
      action: "status_change",
      module: "staff",
      recordId: req.params.id,
      oldValue: before,
      newValue: { status: req.body.status },
    });

    res.status(200).json({ success: true, message: "Staff status updated successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error updating staff status:", error);
    res.status(500).json({ success: false, message: "Failed to update staff status", error: error.message });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const { data: before } = await supabase.from("staff").select(SELECT_NO_PASSWORD).eq("id", req.params.id).maybeSingle();

    const { data, error } = await supabase.from("staff").update({ is_delete: true }).eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }
    await updateAllRoleUserCounts();

    logAudit({ req, action: "delete", module: "staff", recordId: req.params.id, oldValue: before });

    res.status(200).json({ success: true, message: "Staff deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Module 10: best-effort login history, same fire-and-forget convention as
// logAudit()/notifyStaff() -- never blocks or fails the login request.
function recordLoginAttempt({ staffId, attemptedEmail, success, failureReason, req }) {
  supabase
    .from("login_history")
    .insert({
      staff_id: staffId || null,
      attempted_email: attemptedEmail || null,
      success,
      failure_reason: failureReason || null,
      ip_address: req.ip || req.headers?.["x-forwarded-for"] || null,
      user_agent: req.headers?.["user-agent"] || null,
    })
    .then(() => {})
    .catch(() => {});
}

exports.loginStaff = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const { data: staff, error } = await supabase
      .from("staff")
      .select(
        "id, firstName:first_name, lastName:last_name, email, password, status, role:role_id(id, roleName:role_name, isDelete:is_delete, totalUser:total_user, permissions)"
      )
      .eq("email", email.toLowerCase())
      .eq("is_delete", false)
      .maybeSingle();

    if (error) throw error;
    if (!staff) {
      recordLoginAttempt({ attemptedEmail: email.toLowerCase(), success: false, failureReason: "No matching account", req });
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    if (!staff.status) {
      recordLoginAttempt({ staffId: staff.id, attemptedEmail: staff.email, success: false, failureReason: "Account inactive", req });
      return res.status(403).json({ success: false, message: "Account is inactive" });
    }

    const isMatch = await comparePassword(password, staff.password);
    if (!isMatch) {
      recordLoginAttempt({ staffId: staff.id, attemptedEmail: staff.email, success: false, failureReason: "Wrong password", req });
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: staff.id, role: staff.role?.roleName, roleData: staff.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    recordLoginAttempt({ staffId: staff.id, attemptedEmail: staff.email, success: true, req });
    supabase.from("staff").update({ last_login_at: new Date().toISOString() }).eq("id", staff.id).then(() => {}).catch(() => {});

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: staff.id,
        _id: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
        email: staff.email,
        role: staff.role,
        token,
      },
    });
  } catch (error) {
    console.error("Error logging in staff:", error);
    res.status(500).json({ success: false, message: "Failed to login", error: error.message });
  }
};

// Module 10: coarse "who logged in, when, success or failure" view --
// complements audit_logs' field-level record diffs, which never covered
// login/session activity. Gated on setup.staff.view permission (a
// dedicated `useractivity` module key wasn't warranted for one read-only
// listing endpoint).
exports.getLoginHistory = async (req, res) => {
  try {
    const { staffId, success, page = 1, limit = 25 } = req.query;
    let query = supabase
      .from("login_history")
      .select("id, staffId:staff_id(id, firstName:first_name, lastName:last_name, email), attemptedEmail:attempted_email, loginAt:login_at, success, failureReason:failure_reason, ipAddress:ip_address", { count: "exact" })
      .order("login_at", { ascending: false });
    if (staffId) query = query.eq("staff_id", staffId);
    if (success !== undefined) query = query.eq("success", success === "true" || success === true);

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 25;
    const from = (pageNum - 1) * limitNum;
    query = query.range(from, from + limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.status(200).json({
      success: true,
      data: withMongoId(data),
      pagination: { currentPage: pageNum, totalPages: Math.ceil(count / limitNum), totalCount: count, hasNext: from + data.length < count, hasPrev: pageNum > 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching login history: " + error.message });
  }
};

exports.getrol = async (req, res) => {
  try {
    const { roleName } = req.body;
    if (!roleName) {
      return res.status(400).json({ success: false, message: "Role name is required in the request body" });
    }

    const { data: role } = await supabase.from("roles").select("id, roleName:role_name, isDelete:is_delete, totalUser:total_user, permissions").eq("role_name", roleName).maybeSingle();
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    const { data: staffMembers, error } = await supabase
      .from("staff")
      .select(SELECT_NO_PASSWORD)
      .eq("role_id", role.id)
      .eq("is_delete", false);
    if (error) throw error;

    res.status(200).json({
      success: true,
      role: withMongoId(role),
      staffMembers: withMongoId(staffMembers),
      totalStaff: staffMembers.length,
    });
  } catch (error) {
    console.error("Error in getrol:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

async function updateAllRoleUserCounts() {
  try {
    const { data: allStaff } = await supabase.from("staff").select("role_id").eq("is_delete", false);
    const { data: allRoles } = await supabase.from("roles").select("id");

    const counts = {};
    (allStaff || []).forEach((s) => {
      counts[s.role_id] = (counts[s.role_id] || 0) + 1;
    });

    await Promise.all(
      (allRoles || []).map((r) => supabase.from("roles").update({ total_user: counts[r.id] || 0 }).eq("id", r.id))
    );
  } catch (error) {
    console.error("Error updating role user counts:", error);
  }
}

const normalizeAadharNo = (aadharNo) => {
  if (!aadharNo) return null;
  const normalized = Number(aadharNo).toFixed(0);
  return normalized.length === 12 && /^[0-9]{12}$/.test(normalized) ? normalized : null;
};

const normalizeDate = (dateStr) => {
  if (!dateStr) return null;
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split("-");
    const normalized = `${year}-${month}-${day}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) && !isNaN(new Date(normalized).getTime()) ? normalized : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(new Date(dateStr).getTime())) {
    return dateStr;
  }
  return null;
};

// §77: downloads a CSV template with just the header row, so an import
// file matches the columns this endpoint actually expects.
exports.downloadStaffTemplate = async (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="staff-bulk-import-template.csv"');
  res.status(200).send(BULK_TEMPLATE_HEADERS.join(",") + "\n");
};

exports.bulkCreateStaff = async (req, res) => {
  try {
    const { role, companyName } = req.body;
    const { file } = req.files || {};

    if (!req.files || !file || !file[0] || !file[0].buffer) {
      return res.status(400).json({ success: false, message: "No valid CSV file uploaded. Please upload a valid CSV file." });
    }
    if (!role || !companyName) {
      return res.status(400).json({ success: false, message: "Role and CompanyName are required." });
    }
    const { data: roleExists } = await supabase.from("roles").select("id").eq("id", role).maybeSingle();
    if (!roleExists) {
      return res.status(400).json({ success: false, message: `Role not found for ID ${role}.` });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: `Company not found for ID ${companyName}.` });
    }

    const results = [];
    await new Promise((resolve, reject) => {
      Readable.from(file[0].buffer)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    // §77: previously the first bad row aborted the whole file. Now every
    // row is validated and (if valid) inserted independently, so one bad
    // row doesn't block the rest.
    const aadharRegex = /^[0-9]{12}$/;
    const mobileRegex = /^[0-9]{10}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const saved = [];
    const errors = [];

    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      const rowNum = i + 2; // header is row 1, first data row is row 2
      const { firstName, lastName, email, mobileNo, whatsappNo, address, aadharNo, joiningDate, birthDay, password } = row;

      const requiredFields = ["firstName", "lastName", "mobileNo", "whatsappNo", "address", "aadharNo", "joiningDate", "password"];
      const missingField = requiredFields.find((field) => !row[field]);
      if (missingField) {
        errors.push({ row: rowNum, message: `Missing required field '${missingField}'` });
        continue;
      }
      if (!mobileRegex.test(mobileNo)) {
        errors.push({ row: rowNum, message: "Invalid mobileNo" });
        continue;
      }
      if (!mobileRegex.test(whatsappNo)) {
        errors.push({ row: rowNum, message: "Invalid whatsappNo" });
        continue;
      }
      const normalizedAadhar = normalizeAadharNo(aadharNo);
      if (!normalizedAadhar || !aadharRegex.test(normalizedAadhar)) {
        errors.push({ row: rowNum, message: "Invalid aadharNo" });
        continue;
      }
      if (email && !emailRegex.test(email)) {
        errors.push({ row: rowNum, message: "Invalid email" });
        continue;
      }
      const normalizedJoiningDate = normalizeDate(joiningDate);
      if (!normalizedJoiningDate) {
        errors.push({ row: rowNum, message: "Invalid joiningDate" });
        continue;
      }
      const normalizedBirthDay = birthDay ? normalizeDate(birthDay) : null;
      if (birthDay && !normalizedBirthDay) {
        errors.push({ row: rowNum, message: "Invalid birthDay" });
        continue;
      }
      if (email) {
        const { data: existingEmail } = await supabase.from("staff").select("id").eq("email", email).eq("is_delete", false).maybeSingle();
        if (existingEmail) {
          errors.push({ row: rowNum, message: `Email already exists: ${email}` });
          continue;
        }
      }
      const { data: existingAadhar } = await supabase.from("staff").select("id").eq("aadhar_no", normalizedAadhar).eq("is_delete", false).maybeSingle();
      if (existingAadhar) {
        errors.push({ row: rowNum, message: `Aadhar number already exists: ${normalizedAadhar}` });
        continue;
      }

      const { data: insertedStaff, error: insertErr } = await supabase
        .from("staff")
        .insert({
          first_name: firstName,
          last_name: lastName,
          email: email || null,
          mobile_no: mobileNo,
          whatsapp_no: whatsappNo,
          address,
          aadhar_no: normalizedAadhar,
          joining_date: normalizedJoiningDate,
          birth_day: normalizedBirthDay,
          role_id: role,
          company_name_id: companyName,
          password: await hashPassword(password),
          aadhar_files: [],
          address_files: [],
          created_by: req.user?.id || null,
        })
        .select("id")
        .single();

      if (insertErr) {
        errors.push({ row: rowNum, message: insertErr.message });
        continue;
      }
      saved.push(insertedStaff);
    }

    if (saved.length > 0) {
      await updateAllRoleUserCounts();
    }

    const { data: populatedStaff } = saved.length
      ? await supabase.from("staff").select(SELECT_NO_PASSWORD).in("id", saved.map((s) => s.id))
      : { data: [] };

    await logImport({
      req,
      module: "staff",
      fileName: file[0].originalname,
      totalRows: results.length,
      successCount: saved.length,
      failedCount: errors.length,
      errors,
    });

    res.status(200).json({
      success: true,
      message: `Bulk staff upload finished: ${saved.length} succeeded, ${errors.length} failed`,
      count: saved.length,
      errors,
      data: withMongoId(populatedStaff),
    });
  } catch (error) {
    console.error("Bulk create error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to create staff in bulk." });
  }
};

exports.updateStaffPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const staffId = req.params.id;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current password and new password are required" });
    }

    const { data: staff } = await supabase.from("staff").select("id, password").eq("id", staffId).maybeSingle();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    const isMatch = await comparePassword(currentPassword, staff.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }

    const hashedPassword = await hashPassword(newPassword);
    await supabase.from("staff").update({ password: hashedPassword }).eq("id", staffId);

    res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ success: false, message: "Failed to update password", error: error.message });
  }
};

exports.getStaffPermission = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "id is required" });
    }

    const { data: staff } = await supabase
      .from("staff")
      .select("id, role:role_id(permissions)")
      .eq("id", id)
      .maybeSingle();

    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    res.status(200).json({ success: true, message: "Staff role permissions fetched successfully", data: staff.role?.permissions });
  } catch (error) {
    console.error("Error fetching staff permissions:", error);
    res.status(500).json({ success: false, message: "Failed to fetch staff permissions", error: error.message });
  }
};
