/**
 * Operator authentication for the gated RECON tools.
 *
 * The host platform authenticates operators through its own session system.
 * Standalone, this is a deliberately small bearer-token check: set
 * FI_OPERATOR_TOKEN and send `Authorization: Bearer <token>` to act as an
 * operator.
 *
 * It FAILS CLOSED. With no token configured there is no operator, so every
 * aggressive tool answers 401 — which is the correct default for a console
 * that can probe third parties. Swap this file for a real identity provider
 * before exposing those tools to more than one person; the shape
 * (`auth()` → session-or-null) is all the rest of the code depends on.
 */

import { headers } from "next/headers";

export interface OperatorSession {
  user: { email: string };
}

export async function auth(): Promise<OperatorSession | null> {
  const expected = process.env.FI_OPERATOR_TOKEN?.trim();
  if (!expected) return null;

  const provided = (await headers()).get("authorization") ?? "";
  const token = provided.startsWith("Bearer ") ? provided.slice(7).trim() : "";
  if (!token || token !== expected) return null;

  return { user: { email: process.env.FI_OPERATOR_EMAIL?.trim() || "operator@localhost" } };
}
