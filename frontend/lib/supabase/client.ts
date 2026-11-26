"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// This client is used ONLY for Supabase Auth (Google OAuth + session
// management). It is a new, separate concern from the existing RoadGuard
// backend/database — nothing here touches the FastAPI backend or its data.
//
// Requires two env vars (set in frontend/.env.local, see frontend/.env.example):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// Only the public anon key is ever used on the frontend. The service-role
// key already used by the backend for PDF storage must never be exposed here.

let browserClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy frontend/.env.local.example to frontend/.env.local and fill in your Supabase project values."
    );
  }

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return browserClient;
}

// Optional domain restriction. Leave NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN blank
// or commented out to allow any email/Google account.
export const ALLOWED_EMAIL_DOMAIN = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? ""
)
  .trim()
  .toLowerCase()
  .replace(/^@/, "");

export function isAuthorizedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (!ALLOWED_EMAIL_DOMAIN) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === ALLOWED_EMAIL_DOMAIN;
}
