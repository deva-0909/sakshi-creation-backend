const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");

const SELECT = `
  id, type, title, message, entityType:entity_type, entityId:entity_id, link,
  isRead:is_read, createdAt:created_at
`;

// Every notification endpoint is scoped to the caller (req.user.id) --
// there is no "view any staff member's notifications" concept, so none of
// these routes need an authorizePermission gate beyond being logged in.
exports.getMyNotifications = async (req, res) => {
  try {
    const { unreadOnly, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase
      .from("notifications")
      .select(SELECT, { count: "exact" })
      .eq("recipient_staff_id", req.user.id)
      .order("created_at", { ascending: false });
    if (unreadOnly === "true") query = query.eq("is_read", false);

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 20;
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
    res.status(500).json({ success: false, message: "Error fetching notifications: " + error.message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_staff_id", req.user.id)
      .eq("is_read", false);
    if (error) throw error;
    res.status(200).json({ success: true, data: { unreadCount: count || 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching unread count: " + error.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }
    // Scoped to recipient_staff_id so one staff member can never mark
    // another's notification as read via a guessed ID.
    const { data, error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("recipient_staff_id", req.user.id)
      .select(SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error marking notification as read: " + error.message });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("recipient_staff_id", req.user.id).eq("is_read", false);
    if (error) throw error;
    res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error marking notifications as read: " + error.message });
  }
};
