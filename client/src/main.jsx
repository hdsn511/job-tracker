import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import PaperGrainOverlay from "@/components/PaperGrainOverlay";
import ProtectedRoute from "@/components/ProtectedRoute";
import ConnectGmail from "@/pages/ConnectGmail";
import ForwardMail from "@/pages/ForwardMail";
import Backfill from "@/pages/Backfill";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PaperGrainOverlay />
    <BrowserRouter>
      <Routes>
        {/* login / register -> connect gmail -> dashboard */}
        <Route path="/" element={<Login />} />
        <Route
          path="/connect"
          element={
            <ProtectedRoute>
              <ConnectGmail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/connect/forward"
          element={
            <ProtectedRoute>
              <ForwardMail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/backfill"
          element={
            <ProtectedRoute>
              <Backfill />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
