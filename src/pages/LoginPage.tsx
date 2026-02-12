import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const HERO_IMAGE =
  "https://res.cloudinary.com/dr3sbzhsv/image/upload/v1770715406/Axestrack_Bot_Login_Page_N_vbjmgq.webp";

function generateCaptcha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  // We only need session from context to check if already logged in
  const { session } = useAuth(); 

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captcha, setCaptcha] = useState(generateCaptcha);
  const [captchaInput, setCaptchaInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (session) navigate("/", { replace: true }); // Redirect to Home (/), not dashboard
  }, [session, navigate]);

  const refreshCaptcha = useCallback(() => {
    setCaptcha(generateCaptcha());
    setCaptchaInput("");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    
    if (captchaInput !== captcha) {
      toast.error("CAPTCHA does not match");
      refreshCaptcha();
      return;
    }

    setIsLoading(true);

    const email = `${username.trim()}@dispatchmate.local`;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message || "Invalid login credentials");
        refreshCaptcha();
      } else if (data.session) {
        toast.success("Login successful!");
        navigate("/"); // Redirect to Home
      }
    } catch (err) {
      toast.error("An unexpected error occurred");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Left – Hero */}
      <div className="relative h-56 w-full md:h-auto md:w-1/2">
        <img src={HERO_IMAGE} alt="Hero" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <p className="absolute bottom-6 left-6 right-6 text-lg font-light tracking-wide text-white md:text-2xl">
          Axestrack VoiceBots
        </p>
      </div>

      {/* Right – Form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12" style={{ background: "#1a1a2e" }}>
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
          <h1 className="text-2xl font-semibold text-white">Login to your account</h1>

          {/* Username */}
          <div className="space-y-1.5">
            <label className="text-sm text-gray-400">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-[#333] bg-[#2a2a3e] px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-[#6366f1] focus:outline-none"
              placeholder="Enter your username"
              disabled={isLoading}
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-sm text-gray-400">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-[#333] bg-[#2a2a3e] px-3 py-2.5 pr-10 text-sm text-white placeholder:text-gray-500 focus:border-[#6366f1] focus:outline-none"
                placeholder="Enter your password"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                disabled={isLoading}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* CAPTCHA */}
          <div className="space-y-1.5">
            <label className="text-sm text-gray-400">Enter Captcha</label>
            <div className="flex items-center gap-3">
              <div
                className="select-none rounded bg-[#2a2a3e] px-4 py-2 font-mono text-lg tracking-[0.3em] text-[#6366f1]"
                style={{ fontStyle: "italic", letterSpacing: "0.25em", textDecoration: "line-through", textDecorationColor: "rgba(99,102,241,0.25)" }}
              >
                {captcha}
              </div>
              <button type="button" onClick={refreshCaptcha} className="text-gray-400 hover:text-white" disabled={isLoading}>
                <RefreshCw size={18} />
              </button>
            </div>
            <input
              type="text"
              value={captchaInput}
              onChange={(e) => setCaptchaInput(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#333] bg-[#2a2a3e] px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-[#6366f1] focus:outline-none"
              placeholder="Type the characters above"
              disabled={isLoading}
            />
          </div>

          {/* Login button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md py-2.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLoading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
