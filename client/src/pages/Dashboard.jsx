import AddJobModal from "@/components/AddJobModal";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const [activeFilter, setActiveFilter] = useState("All");
  const [jobs, setJobs] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(null); // job id

  const fetchJobs = () => {
    const url =
      activeFilter === "All"
        ? "http://localhost:8000/jobs"
        : `http://localhost:8000/jobs?status=${activeFilter}`;
    fetch(url, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    })
      .then((response) => response.json())
      .then((data) => setJobs(data));
  };

  useEffect(() => {
    fetchJobs();
  }, [activeFilter]);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      navigate("/");
    }
  }, []);

  const handleDelete = (id) => {
    fetch(`http://localhost:8000/jobs/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    }).then(() => fetchJobs());
  };

  const handleUpdate = (id, field, value) => {
    fetch(`http://localhost:8000/jobs/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({ [field]: value }),
    }).then(() => fetchJobs());
  };

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="flex flex-col p-6 gap-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            {/* filter buttons on the left */}
            <Button
              variant={activeFilter === "All" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter("All")}
            >
              All
            </Button>
            <Button
              variant={activeFilter === "Applied" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter("Applied")}
            >
              Applied
            </Button>
            <Button
              variant={activeFilter === "Interviewing" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter("Interviewing")}
            >
              Interviewing
            </Button>
            <Button
              variant={activeFilter === "Offer" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter("Offer")}
            >
              Offer
            </Button>
            <Button
              variant={activeFilter === "Rejected" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter("Rejected")}
            >
              Rejected
            </Button>
          </div>
          <Button onClick={() => setIsModalOpen(true)}>Add Job</Button>
        </div>

        {/* job cards */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date Applied</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Delete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-4">
                  No jobs found. Start by adding a new job!
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{job.company_name}</TableCell>
                  <TableCell>{job.job_title}</TableCell>
                  <TableCell>
                    <Select
                      value={job.status}
                      onValueChange={(value) =>
                        handleUpdate(job.id, "status", value)
                      }
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Applied">Applied</SelectItem>
                        <SelectItem value="Interviewing">
                          Interviewing
                        </SelectItem>
                        <SelectItem value="Offer">Offer</SelectItem>
                        <SelectItem value="Rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{job.application_date}</TableCell>
                  <TableCell>
                    {editingNotes === job.id ? (
                      <Input
                        defaultValue={job.notes}
                        autoFocus
                        onBlur={(e) => {
                          handleUpdate(job.id, "notes", e.target.value);
                          setEditingNotes(null);
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>{job.notes}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingNotes(job.id)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(job.id)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <AddJobModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onJobAdded={fetchJobs}
        />
      </main>
    </div>
  );
}
