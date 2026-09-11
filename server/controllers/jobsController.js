const sql = require("../db");

// Whitelist for updateJob — anything not in here is ignored rather than
// interpolated into the SET clause.
const UPDATABLE_FIELDS = [
  "company_name",
  "job_title",
  "status",
  "application_date",
  "notes",
  "archived",
];

// `application_date` is a bare date, but the driver hands it back as a JS
// Date at local midnight — which JSON-serializes to a UTC instant and can
// land the client a day off. Casting to text keeps it a plain YYYY-MM-DD
// all the way to the calendar.
const getJobs = async (req, res) => {
  const { status, archived } = req.query;
  const includeArchived = archived === "true";

  try {
    const data = status
      ? await sql`
          select id, user_id, company_name, job_title, status,
                 application_date::text as application_date, notes, archived, created_at
          from jobs
          where user_id = ${req.user.id}
            and status = ${status}
            and (${includeArchived}::boolean or archived = false)
          order by application_date desc nulls last, id desc
        `
      : await sql`
          select id, user_id, company_name, job_title, status,
                 application_date::text as application_date, notes, archived, created_at
          from jobs
          where user_id = ${req.user.id}
            and (${includeArchived}::boolean or archived = false)
          order by application_date desc nulls last, id desc
        `;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createJob = async (req, res) => {
  const { company_name, job_title, status, application_date, notes } = req.body;

  try {
    // Returns the row so the client can select the new application without
    // a second round trip to find its id.
    const [job] = await sql`
      insert into jobs (company_name, job_title, status, application_date, notes, user_id)
      values (${company_name}, ${job_title}, ${status}, ${application_date}, ${notes}, ${req.user.id})
      returning id, user_id, company_name, job_title, status,
                application_date::text as application_date, notes, archived, created_at
    `;
    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateJob = async (req, res) => {
  const { id } = req.params;

  const setClauses = [];
  const values = [];

  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] === undefined) continue;
    values.push(req.body[field]);
    setClauses.push(`${field} = $${values.length}`);
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: "No updatable fields provided." });
  }

  // A hand-edited status or title has to survive the next resync --
  // sync/jobs.js's upsertJobFromMessages() checks this flag before letting a
  // re-derived stage/title overwrite what the user set by hand. The column
  // has existed since migration 001 specifically for this ("hand-edited rows
  // are flagged and skipped"), but nothing ever actually set it here, so
  // every manual correction was silently reverted by the next sync/regroup.
  if (req.body.status !== undefined || req.body.job_title !== undefined) {
    setClauses.push("manual_override = true");
  }

  values.push(id, req.user.id);

  try {
    const rows = await sql.query(
      `update jobs set ${setClauses.join(", ")}
       where id = $${values.length - 1} and user_id = $${values.length}
       returning id, user_id, company_name, job_title, status,
                 application_date::text as application_date, notes, archived, manual_override, created_at`,
      values,
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Job not found." });
    }
    res.json(rows[0]);
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
