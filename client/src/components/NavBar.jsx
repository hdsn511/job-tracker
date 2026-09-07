import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function NavBar() {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <h1 className="text-xl font-bold">
        <span className="text-primary">Job</span>Tracker
      </h1>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          localStorage.removeItem("token");
          navigate("/");
        }}
      >
        Logout
      </Button>
    </div>
  );
}
