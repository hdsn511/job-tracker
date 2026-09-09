import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import ConnectGmail from "@/pages/ConnectGmail";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
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
