/**
 * Unit tests for email-templates.ts
 */
import { describe, expect, it } from "vitest";
import { inviteEmail, passwordResetEmail } from "../email-templates.js";

// ── inviteEmail ──────────────────────────────────────────────────────────────

describe("inviteEmail", () => {
  const args = {
    inviterName: "Alice Smith",
    orgName: "Acme Corp",
    acceptLink: "https://brain.example.com/accept-invite?token=abc123",
    expiresAt: "2026-05-01T12:00:00.000Z",
  };

  it("subject includes inviter name and org name", () => {
    const { subject } = inviteEmail(args);
    expect(subject).toContain("Alice Smith");
    expect(subject).toContain("Acme Corp");
  });

  it("html contains the acceptLink", () => {
    const { html } = inviteEmail(args);
    expect(html).toContain(args.acceptLink);
  });

  it("html contains inviter name", () => {
    const { html } = inviteEmail(args);
    expect(html).toContain("Alice Smith");
  });

  it("html contains org name", () => {
    const { html } = inviteEmail(args);
    expect(html).toContain("Acme Corp");
  });

  it("html contains the expiry date", () => {
    const { html } = inviteEmail(args);
    expect(html).toContain("2026");
  });

  it("plaintext contains the acceptLink", () => {
    const { text } = inviteEmail(args);
    expect(text).toContain(args.acceptLink);
  });

  it("plaintext contains inviter name", () => {
    const { text } = inviteEmail(args);
    expect(text).toContain("Alice Smith");
  });

  it("plaintext contains org name", () => {
    const { text } = inviteEmail(args);
    expect(text).toContain("Acme Corp");
  });

  it("html escapes special characters in org name to prevent XSS", () => {
    const { html } = inviteEmail({ ...args, orgName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns subject, html, and text (all non-empty)", () => {
    const result = inviteEmail(args);
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html.length).toBeGreaterThan(100);
    expect(result.text.length).toBeGreaterThan(20);
  });
});

// ── passwordResetEmail ───────────────────────────────────────────────────────

describe("passwordResetEmail", () => {
  const args = {
    userName: "Bob Tester",
    resetLink: "https://brain.example.com/reset-password?token=xyz789",
    expiresAt: "2026-05-01T13:00:00.000Z",
  };

  it("subject mentions password reset", () => {
    const { subject } = passwordResetEmail(args);
    expect(subject.toLowerCase()).toContain("reset");
  });

  it("html contains the resetLink", () => {
    const { html } = passwordResetEmail(args);
    expect(html).toContain(args.resetLink);
  });

  it("html contains user name", () => {
    const { html } = passwordResetEmail(args);
    expect(html).toContain("Bob Tester");
  });

  it("html contains a warning for users who did not request this", () => {
    const { html } = passwordResetEmail(args);
    // Should have some variant of "did not request" or "Did not request"
    expect(html.toLowerCase()).toContain("did not request");
  });

  it("plaintext contains the resetLink", () => {
    const { text } = passwordResetEmail(args);
    expect(text).toContain(args.resetLink);
  });

  it("plaintext contains a 'did not request' warning", () => {
    const { text } = passwordResetEmail(args);
    expect(text.toLowerCase()).toContain("did not request");
  });

  it("plaintext mentions 1 hour validity", () => {
    const { text } = passwordResetEmail(args);
    expect(text.toLowerCase()).toContain("1 hour");
  });

  it("html escapes user name to prevent XSS", () => {
    const { html } = passwordResetEmail({ ...args, userName: '<img src=x onerror="bad()">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("returns subject, html, and text (all non-empty)", () => {
    const result = passwordResetEmail(args);
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html.length).toBeGreaterThan(100);
    expect(result.text.length).toBeGreaterThan(20);
  });
});
