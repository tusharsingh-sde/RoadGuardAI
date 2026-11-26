"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/supabase/client";

const FEATURES = [
  {
    title: "Live Drone & Cam",
    desc: "IP Webcam, USB & mobile streams",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
  },
  {
    title: "YOLOv11 + ByteTrack",
    desc: "Real-time pothole detection & tracking",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    title: "Instant ₹ Costing",
    desc: "Automated PWD-grade repair estimates",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 3h12" />
        <path d="M6 8h12" />
        <path d="m6 13 8.5 8" />
        <path d="M6 13h3a4 4 0 0 0 0-8" />
      </svg>
    ),
  },
  {
    title: "Geo-Tagged PDFs",
    desc: "Auto-emailed inspection reports",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
];

type Mode = "sign-in" | "sign-up";

export default function LoginPage() {
  const { status, signInWithGoogle, signInWithEmail, signUpWithEmail, errorMessage } =
    useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  useEffect(() => {
    if (status === "authorized") {
      router.replace("/");
    }
  }, [status, router]);

  if (status === "loading") {
    return <div className="login-loading">Checking your session…</div>;
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setFormError(null);
    setConfirmationSent(false);
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setConfirmationSent(false);

    if (!email || !password) {
      setFormError("Please enter your email and password.");
      return;
    }

    if (mode === "sign-up") {
      if (password.length < 6) {
        setFormError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setFormError("Passwords do not match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "sign-in") {
        const { error } = await signInWithEmail(email, password);
        if (error) setFormError(error);
      } else {
        const { error, needsEmailConfirmation } = await signUpWithEmail(
          email,
          password
        );
        if (error) {
          setFormError(error);
        } else if (needsEmailConfirmation) {
          setConfirmationSent(true);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setFormError(null);
    setGoogleSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Google sign-in failed. Please try again."
      );
      setGoogleSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="brand login-brand-lockup">
          <div className="brand-logo login-brand-logo">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19L8 5" />
              <path d="M20 19L16 5" />
              <line x1="12" y1="7" x2="12" y2="9" />
              <line x1="12" y1="13" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <h1 className="login-brand-name">
              RoadGuard <span>AI</span>
            </h1>
            <p className="login-brand-sub">Pothole Detection System</p>
          </div>
        </div>

        <div className="login-status-pill">
          <span className="login-status-dot" />
          <span>YOLOv11 • LIVE ROAD TELEMETRY</span>
        </div>

        <h2 className="login-hero-title">
          Smarter Roads,
          <span>Safer Journeys</span>
        </h2>
        <p className="login-hero-desc">
          AI-powered pothole detection and road condition monitoring for
          better infrastructure management.
        </p>

        <div className="login-features-grid">
          {FEATURES.map((feature) => (
            <div className="login-feature-card" key={feature.title}>
              <div className="login-feature-icon">{feature.icon}</div>
              <div className="login-feature-content">
                <div className="login-feature-title">{feature.title}</div>
                <div className="login-feature-desc">{feature.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h1>{mode === "sign-in" ? "Welcome Back" : "Create Account"}</h1>
          <p>
            {mode === "sign-in"
              ? "Sign in to your RoadGuard AI account"
              : "Register a new RoadGuard AI account"}
          </p>

          <div className="login-tabs">
            <button
              type="button"
              className={mode === "sign-in" ? "login-tab active" : "login-tab"}
              onClick={() => switchMode("sign-in")}
            >
              Sign In
            </button>
            <button
              type="button"
              className={mode === "sign-up" ? "login-tab active" : "login-tab"}
              onClick={() => switchMode("sign-up")}
            >
              Register
            </button>
          </div>

          {confirmationSent ? (
            <div className="login-success">
              We&apos;ve sent a confirmation link to <strong>{email}</strong>.
              Please verify your email, then sign in.
            </div>
          ) : (
            <form className="login-form" onSubmit={handleSubmit}>
              <label className="login-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder={
                    ALLOWED_EMAIL_DOMAIN
                      ? `you@${ALLOWED_EMAIL_DOMAIN}`
                      : "you@example.com"
                  }
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="login-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>

              {mode === "sign-up" && (
                <label className="login-field">
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </label>
              )}

              <button className="primary-btn" type="submit" disabled={submitting}>
                {submitting
                  ? "Please wait…"
                  : mode === "sign-in"
                    ? "Sign In"
                    : "Create Account"}
              </button>
            </form>
          )}

          <div className="login-divider">
            <span>or</span>
          </div>

          <button
            type="button"
            className="google-btn"
            onClick={handleGoogleSignIn}
            disabled={submitting || googleSubmitting}
          >
            <GoogleIcon />
            {googleSubmitting ? "Redirecting to Google…" : "Continue with Google"}
          </button>

          {ALLOWED_EMAIL_DOMAIN && (
            <p className="login-domain-note">
              Access is limited to @{ALLOWED_EMAIL_DOMAIN} accounts.
            </p>
          )}

          {!confirmationSent &&
            (formError || status === "unauthorized-domain" || errorMessage) && (
              <div className="login-error">
                {formError ||
                  errorMessage ||
                  (ALLOWED_EMAIL_DOMAIN
                    ? `You are not eligible to access RoadGuard AI. Please use your @${ALLOWED_EMAIL_DOMAIN} account.`
                    : "You are not eligible to access RoadGuard AI.")}
              </div>
            )}
        </div>
      </section>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.6 34.9 27 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.5 5.5C40.9 36.6 44 31.1 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}
