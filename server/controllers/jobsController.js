const sql = require("../db");

const getJobs = async (req, res) => {
  const { status } = req.query;

  try {
    const data = status
      ? await sql`select * from jobs where user_id = ${req.user.id} and status = ${status}`
      : await sql`select * from jobs where user_id = ${req.user.id}`;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createJob = async (req, res) => {
  const { company_name, job_title, status, application_date, notes } = req.body;

  try {
    await sql`
      insert into jobs (company_name, job_title, status, application_date, notes, user_id)
      values (${company_name}, ${job_title}, ${status}, ${application_date}, ${notes}, ${req.user.id})
    `;
    res.status(201).json({ message: "Job created successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateJob = async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const setClauses = [];
  const values = [];

  if (status) {
    values.push(status);
    setClauses.push(`status = $${values.length}`);
  }
  if (notes) {
    values.push(notes);
    setClauses.push(`notes = $${values.length}`);
  }

  if (setClauses.length === 0) {
    return res.json({ message: "Job updated successfully!" });
  }

  values.push(id, req.user.id);

  try {
    await sql.query(
      `update jobs set ${setClauses.join(", ")} where id = $${values.length - 1} and user_id = $${values.length}`,
      values,
    );
    res.json({ message: "Job updated successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteJob = async (req, res) => {
  const { id } = req.params;

  try {
    await sql`delete from jobs where id = ${id} and user_id = ${req.user.id}`;
    res.json({ message: "Job deleted successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getJobs,
  createJob,
  updateJob,
  deleteJob,
};
