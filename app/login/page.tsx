"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Compass, LoaderCircle, Mail, ShieldCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get("error") ?? "");
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (signInError) throw signInError;
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to send the sign-in link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand brand-light">
          <span className="brand-mark"><Compass size={20} strokeWidth={2.4} /></span>
          <span>InboxScout</span>
        </div>
        <div className="login-story-copy">
          <span className="eyebrow eyebrow-light">Thoughtful outreach, better opportunities</span>
          <h1>Find the right inbox.<br />Make your work count.</h1>
          <p>
            Discover public agency contacts in Nepal and around the world, then turn a carefully
            reviewed shortlist into a respectful job-outreach campaign.
          </p>
          <div className="login-points">
            <span><Check size={17} /> Public, source-backed contacts</span>
            <span><Check size={17} /> Human approval before sending</span>
            <span><Check size={17} /> Private CV storage and Gmail OAuth</span>
          </div>
        </div>
        <p className="login-note">Built for focused creative job searches—not mass email.</p>
      </section>

      <section className="login-form-wrap">
        <div className="login-form-card">
          <div className="login-icon"><Mail size={24} /></div>
          <span className="eyebrow">Your private workspace</span>
          <h2>{sent ? "Check your inbox" : "Welcome to InboxScout"}</h2>
          {sent ? (
            <div className="login-success">
              <div className="success-ring"><Check size={28} /></div>
              <p>We sent a secure sign-in link to <strong>{email}</strong>.</p>
              <button className="text-button" onClick={() => setSent(false)}>Use another email</button>
            </div>
          ) : (
            <>
              <p className="login-subtitle">Enter your email and we’ll send you a password-free sign-in link.</p>
              <form onSubmit={submit} className="login-form">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                {error && <p className="field-error" role="alert">{error}</p>}
                <button className="primary-button full-button" disabled={loading}>
                  {loading ? <LoaderCircle className="spin" size={18} /> : <>Send secure link <ArrowRight size={17} /></>}
                </button>
              </form>
              <p className="security-copy"><ShieldCheck size={15} /> Authentication is handled securely by Supabase.</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
