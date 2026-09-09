import { Navigate } from "react-router-dom";
import { getToken } from "@/lib/api";

export default function ProtectedRoute({ children }) {
  if (!getToken()) {
    return <Navigate to="/" replace />;
  }
  return children;
}
