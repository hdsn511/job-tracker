import { Navigate } from "react-router-dom";
import { isAuthed } from "@/lib/api";

export default function ProtectedRoute({ children }) {
  if (!isAuthed()) {
    return <Navigate to="/" replace />;
  }
  return children;
}
