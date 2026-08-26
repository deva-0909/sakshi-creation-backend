const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");

const TASK_SELECT = `
  id, date, time, reasonForVisit:reason_for_visit, remarks, status, visitDate:visit_date, visitTime:visit_time,
  feedback, rescheduleDate:reschedule_date, isRescheduledTask:is_rescheduled_task, createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  partyName:party_name_id(id, partyName:party_name, address, ownerName:owner_name, personMobileNo:person_mobile_no),
  assignTo:assign_to(id, firstName:first_name, lastName:last_name),
  originalTaskId:original_task_id(id, date, status, createdAt:created_at)
`;

async function attachCreatedBy(task) {
  if (!task || !task.companyName || !task.partyName) return { ...task, createdBy: null };
  const { data: am } = await supabase
    .from("account_masters")
    .select("createdBy:created_by(id, firstName:first_name, lastName:last_name)")
    .eq("company_name_id", task.companyName.id)
    .eq("party_id", task.partyName.id)
    .maybeSingle();
  return { ...task, createdBy: am?.createdBy || null };
}

exports.createAssignTask = async (req, res) => {
  try {
    const { companyName, partyName, date, time, reasonForVisit, assignTo } = req.body;
    if (!companyName || !partyName || !date || !reasonForVisit || !assignTo) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }
    if (!isValidId(companyName) || !isValidId(partyName) || !isValidId(assignTo)) {
      return res.status(400).json({ success: false, message: "Invalid ID format" });
    }

    const { data: inserted, error } = await supabase
      .from("assign_tasks")
      .insert({
        company_name_id: companyName,
        party_name_id: partyName,
        date,
        time: time || null,
        reason_for_visit: reasonForVisit,
        remarks: req.body.remarks || "",
        assign_to: assignTo,
        status: req.body.status || "Pending",
        visit_date: req.body.visitDate || null,
        visit_time: req.body.visitTime || "",
        feedback: req.body.feedback || "",
        is_rescheduled_task: req.body.isRescheduledTask || false,
        original_task_id: req.body.originalTaskId || null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: populated } = await supabase.from("assign_tasks").select(TASK_SELECT).eq("id", inserted.id).single();
    const taskWithCreatedBy = await attachCreatedBy(withMongoId(populated));

    res.status(201).json({ success: true, message: "Task assigned successfully", data: taskWithCreatedBy });
  } catch (error) {
    console.error("Error creating assign task:", error);
    res.status(500).json({ success: false, message: "Failed to create task", error: error.message });
  }
};

exports.getAllAssignTasks = async (req, res) => {
  try {
    // "party_name" is not a local column on assign_tasks (it lives on the
    // joined parties table via party_name_id) — pagination only, no search.
    const { page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase
      .from("assign_tasks")
      .select(TASK_SELECT, { count: "exact" })
      .eq("is_delete", false)
      .order("created_at", { ascending: false });

    // Multi-role audit fix (Finding 1): authorizeView() attaches this when the
    // caller's role only has view_own (not view_global) for this module.
    if (req.viewOwnFilter) query = query.eq(req.viewOwnFilter.column, req.viewOwnFilter.value);

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
    const tasksWithCreatedBy = await Promise.all(withMongoId(data).map(attachCreatedBy));

    const response = { success: true, count: tasksWithCreatedBy.length, data: tasksWithCreatedBy };
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
    res.status(500).json({ success: false, message: "Failed to fetch tasks", error: error.message });
  }
};

exports.getAssignTaskById = async (req, res) => {
  try {
    const { data: task, error } = await supabase.from("assign_tasks").select(TASK_SELECT).eq("id", req.params.id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!task) {
      return res.status(404).json({ success: false, message: "Assign task not found" });
    }

    const { data: am } = await supabase
      .from("account_masters")
      .select(
        "id, reasonToVisit:reason_to_visit, createdBy:created_by(id, firstName:first_name, lastName:last_name), party:party_id(*)"
      )
      .eq("company_name_id", task.companyName?.id)
      .eq("party_id", task.partyName?.id)
      .maybeSingle();

    res.status(200).json({
      success: true,
      data: { ...withMongoId(task), accountDetails: am ? withMongoId(am) : null, rescheduleDate: task.rescheduleDate },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateAssignTask = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID format" });
    }

    const { data: existingTask } = await supabase.from("assign_tasks").select("*").eq("id", id).maybeSingle();
    if (!existingTask) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    if (updateData.time && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(updateData.time)) {
      return res.status(400).json({ success: false, message: "Invalid time format. Use HH:MM (24-hour format)" });
    }
    if (updateData.visitTime && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(updateData.visitTime)) {
      return res.status(400).json({ success: false, message: "Invalid visit time format. Use HH:MM (24-hour format)" });
    }

    let newTaskRecord = null;

    if (updateData.status) {
      if (!["Pending", "Rescheduled", "Completed", "Cancelled"].includes(updateData.status)) {
        return res.status(400).json({ success: false, message: "Invalid status value" });
      }

      if (updateData.status === "Rescheduled") {
        if (!updateData.rescheduleDate || isNaN(new Date(updateData.rescheduleDate).getTime())) {
          return res.status(400).json({
            success: false,
            message: "Reschedule date is required and must be a valid date when status is Rescheduled",
          });
        }
        const rescheduleDate = new Date(updateData.rescheduleDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (rescheduleDate < today) {
          return res.status(400).json({ success: false, message: "Reschedule date must be a future date" });
        }

        const { data: inserted, error } = await supabase
          .from("assign_tasks")
          .insert({
            company_name_id: existingTask.company_name_id,
            party_name_id: existingTask.party_name_id,
            date: rescheduleDate.toISOString().slice(0, 10),
            time: existingTask.time,
            reason_for_visit: existingTask.reason_for_visit,
            remarks: existingTask.remarks,
            assign_to: existingTask.assign_to,
            status: "Pending",
            is_rescheduled_task: true,
            original_task_id: existingTask.id,
          })
          .select("id")
          .single();
        if (error) throw error;

        const { data: populatedNew } = await supabase.from("assign_tasks").select(TASK_SELECT).eq("id", inserted.id).single();
        newTaskRecord = withMongoId(populatedNew);
      } else {
        updateData.rescheduleDate = null;
      }
    }

    const patch = {
      ...(updateData.companyName && { company_name_id: updateData.companyName }),
      ...(updateData.partyName && { party_name_id: updateData.partyName }),
      ...(updateData.assignTo && { assign_to: updateData.assignTo }),
      ...(updateData.date && { date: updateData.date }),
      ...(updateData.time && { time: updateData.time }),
      ...(updateData.reasonForVisit && { reason_for_visit: updateData.reasonForVisit }),
      ...(updateData.remarks !== undefined && { remarks: updateData.remarks }),
      ...(updateData.status && { status: updateData.status }),
      ...(updateData.visitDate && { visit_date: updateData.visitDate }),
      ...(updateData.visitTime !== undefined && { visit_time: updateData.visitTime }),
      ...(updateData.feedback !== undefined && { feedback: updateData.feedback }),
      reschedule_date: updateData.status === "Rescheduled" ? updateData.rescheduleDate : null,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedTask, error: updateErr } = await supabase
      .from("assign_tasks")
      .update(patch)
      .eq("id", id)
      .select(TASK_SELECT)
      .maybeSingle();
    if (updateErr) throw updateErr;
    if (!updatedTask) {
      return res.status(404).json({ success: false, message: "Task not found after update" });
    }

    const taskWithCreatedBy = await attachCreatedBy(withMongoId(updatedTask));
    const responseData = { originalTask: taskWithCreatedBy };
    if (updateData.status === "Rescheduled" && newTaskRecord) {
      responseData.newTask = {
        message: "New task created with rescheduled date",
        rescheduledDate: updateData.rescheduleDate,
        data: newTaskRecord,
      };
    }

    res.status(200).json({
      success: true,
      message: updateData.status === "Rescheduled" ? "Task rescheduled successfully and new task created" : "Task updated successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Error updating assign task:", error);
    res.status(500).json({ success: false, message: "Failed to update task. Please try again.", error: error.message });
  }
};

exports.updateAssignTaskStatus = async (req, res) => {
  try {
    const { status, rescheduleDate } = req.body;
    if (!["Pending", "Rescheduled", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    const updateData = { status, updated_at: new Date().toISOString() };
    if (status === "Rescheduled") {
      if (!rescheduleDate || isNaN(new Date(rescheduleDate).getTime())) {
        return res.status(400).json({ success: false, message: "rescheduleDate is required and must be a valid date when status is Rescheduled" });
      }
      const rescheduleDateObj = new Date(rescheduleDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (rescheduleDateObj < today) {
        return res.status(400).json({ success: false, message: "rescheduleDate must be a future date" });
      }
      updateData.reschedule_date = rescheduleDateObj.toISOString().slice(0, 10);
    } else {
      updateData.reschedule_date = null;
    }

    const { data: updatedTask, error } = await supabase
      .from("assign_tasks")
      .update(updateData)
      .eq("id", req.params.id)
      .select(TASK_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!updatedTask) {
      return res.status(404).json({ success: false, message: "Assign task not found" });
    }

    const { data: am } = await supabase
      .from("account_masters")
      .select("createdBy:created_by(id, firstName:first_name, lastName:last_name)")
      .eq("company_name_id", updatedTask.companyName?.id)
      .eq("party_id", updatedTask.partyName?.id)
      .maybeSingle();

    res.status(200).json({
      success: true,
      message: "Assign task status updated successfully",
      data: { ...withMongoId(updatedTask), accountDetails: am || null },
    });
  } catch (error) {
    console.error("Error updating assign task status:", error);
    res.status(500).json({ success: false, message: "Failed to update assign task status", error: error.message });
  }
};

exports.deleteAssignTask = async (req, res) => {
  try {
    const { data, error } = await supabase.from("assign_tasks").update({ is_delete: true }).eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Assign task not found" });
    }
    res.status(200).json({ success: true, message: "Assign task deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPartyNamesByCompany = async (req, res) => {
  try {
    const { companyName } = req.query;
    if (!companyName || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid or missing companyName" });
    }
    const { data, error } = await supabase
      .from("account_masters")
      .select("party:party_id(party_name)")
      .eq("company_name_id", companyName);
    if (error) throw error;
    res.status(200).json({ success: true, data: (data || []).map((p) => p.party?.party_name).filter(Boolean) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTasksByStaffId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid staff ID format" });
    }
    const { data: staff } = await supabase.from("staff").select("id").eq("id", id).maybeSingle();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }

    const { data: tasks, error } = await supabase
      .from("assign_tasks")
      .select(TASK_SELECT)
      .eq("assign_to", id)
      .eq("is_delete", false)
      .order("created_at", { ascending: false });
    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      return res.status(200).json({ success: true, message: "No tasks found for this staff member", count: 0, data: [] });
    }

    const tasksWithCreatedBy = await Promise.all(withMongoId(tasks).map(attachCreatedBy));

    res.status(200).json({ success: true, message: "Tasks retrieved successfully", count: tasksWithCreatedBy.length, data: tasksWithCreatedBy });
  } catch (error) {
    console.error("Error fetching tasks by staff ID:", error);
    res.status(500).json({ success: false, message: "Failed to fetch tasks", error: error.message });
  }
};
