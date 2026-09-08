import AddJobModal from "@/components/AddJobModal";
import NavBar from "@/components/NavBar";
import { Badge } from "@/components/ui/badge";
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
import { Mail, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";


export default function Dashboard() {
  const [activeFilter, setActiveFilter] = useState("All");
  const [jobs, setJobs] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(null); // job id
  const [gmailStatus, setGmailStatus] = useState(null); // { connected, gmailAddress }
  const [gmailMessage, setGmailMessage] = useState(null); // "connected" | "error"
  const navigate = useNavigate();
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  const fetchJobs = () => {
    const url =
      activeFilter === "All"
        ? `${API_URL}/jobs`
        : `${API_URL}/jobs?status=${activeFilter}`;
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

  const fetchGmailStatus = () => {
    fetch(`${API_URL}/auth/gmail/status`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    })
      .then((response) => response.json())
      .then((data) => setGmailStatus(data));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (gmail === "connected" || gmail === "error") {
      setGmailMessage(gmail);
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetchGmailStatus();
  }, []);

  const handleConnectGmail = () => {
    fetch(`${API_URL}/auth/gmail/connect`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    })
      .then((response) => response.json())
      .then((data) => {
        window.location.href = data.url;
      });
  };

  const handleDelete = (id) => {
    fetch(`${API_URL}/jobs/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    }).then(() => fetchJobs());
  };

  const handleUpdate = (id, field, value) => {
    fetch(`${API_URL}/jobs/${id}`, {
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
        <h2 className="text-2xl font-semibold text-foreground">My Applications</h2>

        {gmailMessage === "connected" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            Gmail connected. New application emails will be picked up automatically.
          </div>
        )}
        {gmailMessage === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            Couldn&apos;t connect Gmail. Please try again.
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            {gmailStatus?.connected ? (
              <span className="text-sm">
                Gmail connected <Badge variant="secondary">{gmailStatus.gmailAddress}</Badge>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                Connect Gmail to auto-track applications from your inbox.
              </span>
            )}
          </div>
          {!gmailStatus?.connected && (
            <Button variant="outline" size="sm" onClick={handleConnectGmail}>
              Connect Gmail
            </Button>
          )}
        </div>

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
        <div className="rounded-xl border border-border bg-card overflow-hidden">
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
                <TableCell colSpan={6} className="text-center py-4">
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
        </div>
        <AddJobModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onJobAdded={fetchJobs}
        />
      </main>
    </div>
  );
}
