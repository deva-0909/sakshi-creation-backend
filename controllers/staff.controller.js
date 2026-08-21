const supabase = require("../lib/supabaseClient");
const jwt = require("jsonwebtoken");
const { isValidId, withMongoId, hashPassword, comparePassword, maskAadhar } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { Readable } = require("stream");
const csv = require("csv-parser");

const SELECT_NO_PASSWORD = `
  id, firstName:first_name, lastName:last_name, email, mobileNo:mobile_no, whatsappNo:whatsapp_no,
  address, aadharNo:aadhar_no, joiningDate:joining_date, birthDay:birth_day, status,
  aadharFiles:aadhar_files, addressFiles:address_files, createdAt:created_at, updatedAt:updated_at,
  role:role_id(id, roleName:role_name, isDelete:is_delete, totalUser:total_user, permissions),
  CompanyName:company_name_id(id, companyName:company_name, avatar)
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
      const { data: existingEmail } = await supabase.from("staff").select("id").eq("email", email).maybeSingle();
      if (existingEmail) {
        return res.status(400).json({ success: false, message: "Email already in use" });
      }
    }

    const aadharRegex = /^[0-9]{12}$/;
    if (!aadharRegex.test(req.body.aadharNo)) {
      return res.status(400).json({ success: false, message: "Invalid Aadhar number format. Must be 12 digits." });
    }

    const { data: existingAadhar } = await supabase.from("staff").select("id").eq("aadhar_no", req.body.aadharNo).maybeSingle();
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
    const { data, error } = await supabase.from("staff").select(SELECT_NO_PASSWORD);
    if (error) throw error;
    // Bulk listing — mask Aadhar here so one call can't enumerate every
    // staff member's full number. getStaffById still returns the full
    // number, since that's what the edit form needs.
    const masked = (data || []).map((row) => ({ ...row, aadharNo: maskAadhar(row.aadharNo) }));
    res.status(200).json({ success: true, data: withMongoId(masked) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getStaffById = async (req, res) => {
  try {
    const { data, error } = await supabase.from("staff").select(SELECT_NO_PASSWORD).eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
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
      updated_at: new Date().toISOString(),
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

    const { data, error } = await supabase.from("staff").delete().eq("id", req.params.id).select("id").maybeSingle();
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
      .maybeSingle();

    if (error) throw error;
    if (!staff) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    if (!staff.status) {
      return res.status(403).json({ success: false, message: "Account is inactive" });
    }

    const isMatch = await comparePassword(password, staff.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: staff.id, role: staff.role?.roleName, roleData: staff.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

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
      .eq("role_id", role.id);
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
    const { data: allStaff } = await supabase.from("staff").select("role_id");
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

    const aadharRegex = /^[0-9]{12}$/;
    const mobileRegex = /^[0-9]{10}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const staffMembers = [];

    for (const row of results) {
      const { firstName, lastName, email, mobileNo, whatsappNo, address, aadharNo, joiningDate, birthDay, password } = row;

      const requiredFields = ["firstName", "lastName", "mobileNo", "whatsappNo", "address", "aadharNo", "joiningDate", "password"];
      for (const field of requiredFields) {
        if (!row[field]) {
          return res.status(400).json({ success: false, message: `Missing required field '${field}' in row: ${JSON.stringify(row)}.` });
        }
      }
      if (!mobileRegex.test(mobileNo)) {
        return res.status(400).json({ success: false, message: `Invalid mobileNo in row: ${JSON.stringify(row)}.` });
      }
      if (!mobileRegex.test(whatsappNo)) {
        return res.status(400).json({ success: false, message: `Invalid whatsappNo in row: ${JSON.stringify(row)}.` });
      }
      const normalizedAadhar = normalizeAadharNo(aadharNo);
      if (!normalizedAadhar || !aadharRegex.test(normalizedAadhar)) {
        return res.status(400).json({ success: false, message: `Invalid aadharNo in row: ${JSON.stringify(row)}.` });
      }
      if (email && !emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: `Invalid email in row: ${JSON.stringify(row)}.` });
      }
      const normalizedJoiningDate = normalizeDate(joiningDate);
      if (!normalizedJoiningDate) {
        return res.status(400).json({ success: false, message: `Invalid joiningDate in row: ${JSON.stringify(row)}.` });
      }
      const normalizedBirthDay = birthDay ? normalizeDate(birthDay) : null;
      if (birthDay && !normalizedBirthDay) {
        return res.status(400).json({ success: false, message: `Invalid birthDay in row: ${JSON.stringify(row)}.` });
      }
      if (email) {
        const { data: existingEmail } = await supabase.from("staff").select("id").eq("email", email).maybeSingle();
        if (existingEmail) {
          return res.status(400).json({ success: false, message: `Email already exists: ${email}` });
        }
      }
      const { data: existingAadhar } = await supabase.from("staff").select("id").eq("aadhar_no", normalizedAadhar).maybeSingle();
      if (existingAadhar) {
        return res.status(400).json({ success: false, message: `Aadhar number already exists: ${normalizedAadhar}` });
      }

      staffMembers.push({
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
      });
    }

    const { data: savedStaff, error } = await supabase.from("staff").insert(staffMembers).select("id");
    if (error) throw error;

    await updateAllRoleUserCounts();

    const { data: populatedStaff } = await supabase
      .from("staff")
      .select(SELECT_NO_PASSWORD)
      .in("id", savedStaff.map((s) => s.id));

    res.status(201).json({ success: true, message: "Bulk staff creation completed", count: savedStaff.length, data: withMongoId(populatedStaff) });
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
