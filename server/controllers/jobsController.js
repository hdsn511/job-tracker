const client = require("../supabaseClient");

const getJobs = async (req, res) => {
  const { status } = req.query;

  let query = client.from('jobs').select().eq('user_id', req.user.id);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
};

const createJob = async (req, res) => {
  const { company_name, job_title, status, application_date, notes } = req.body;

  const { error } = await client.from("jobs").insert({
    company_name,
    job_title,
    status,
    application_date,
    notes,
    user_id: req.user.id,
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ message: "Job created successfully!" });
};

const updateJob = async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const updates = {};

  if (status) updates.status = status;
  if (notes) updates.notes = notes;

  const { error } = await client
    .from("jobs")
    .update(updates)
    .eq("id", id)
    .eq("user_id", req.user.id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ message: "Job updated successfully!" });
};

const deleteJob = async (req, res) => {
  const { id } = req.params;

  const { error } = await client
    .from("jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", req.user.id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ message: "Job deleted successfully!" });
};

module.exports = {
  getJobs,
  createJob,
  updateJob,
  deleteJob,
};
