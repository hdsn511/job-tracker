import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistered, setIsRegistered] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  const login = async (email, password) => {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (data.token) {
      localStorage.setItem("token", data.token);
      navigate("/dashboard");
    }
    else {
      setError("Invalid email or password. Please try again.");
    }
  };

  const handleSubmit = async (e) => {
    if (isRegistered) {
      login(email, password);
    } else {
      fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.error) {
            setError(
              "An account with this email already exists. Please Login or try again.",
            );
          } else {
            login(email, password);
          }
        });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card border border-border rounded-xl p-8 w-full max-w-sm flex flex-col gap-4 shadow-lg">
        <h1 className="text-2xl font-bold text-center text-foreground">
          {isRegistered ? "Welcome Back" : "Create Account"}
        </h1>
        <Input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        <Button onClick={handleSubmit}>
          {isRegistered ? "Login" : "Register"}
        </Button>
        <p
          onClick={() => {
            setIsRegistered(!isRegistered);
            setError("");
          }}
          className="text-sm text-center text-muted-foreground cursor-pointer hover:underline"
        >
          {isRegistered
            ? "Don't have an account? Register"
            : "Already have an account? Login"}
        </p>
      </div>
    </div>
  );
}
