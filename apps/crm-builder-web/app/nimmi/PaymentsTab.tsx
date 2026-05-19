// CRM Payments tab — client component
// File path: app/nimmi/PaymentsTab.tsx
// Import in your /nimmi/page.tsx and add as 5th tab

"use client";

import { useEffect, useState } from "react";

interface Payment {
  id: number;
  nimmi_payment_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  services: Array<{ slug: string; name: string; basePrice: number }>;
  base_price: string;
  discount_amount: string;
  final_amount: string;
  payment_reference: string | null;
  scan_status: string | null;
  scan_detected_amount: string | null;
  scan_detected_recipient: string | null;
  scan_notes: string | null;
  newton_status: "pending" | "verified" | "rejected" | "refunded";
  newton_verified_by: string | null;
  newton_verified_at: string | null;
  received_at: string;
}

export function PaymentsTab() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "verified" | "rejected">("all");
  const [updating, setUpdating] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const url = filter === "all" ? "/api/nimmi/payments" : `/api/nimmi/payments?status=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      setPayments(data.rows || []);
    } catch (err) {
      console.error("Failed to load payments:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  async function updateStatus(id: number, status: "verified" | "rejected" | "refunded") {
    setUpdating(id);
    try {
      const res = await fetch(`/api/nimmi/payments?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newton_status: status }),
      });
      if (res.ok) {
        await load();
      }
    } finally {
      setUpdating(null);
    }
  }

  function fmtCurrency(v: string | null) {
    if (v === null) return "—";
    return `$${parseFloat(v).toFixed(2)}`;
  }

  function fmtDate(v: string | null) {
    if (!v) return "—";
    const d = new Date(v);
    return d.toLocaleString("en-CA", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const counts = {
    all: payments.length,
    pending: payments.filter((p) => p.newton_status === "pending").length,
    verified: payments.filter((p) => p.newton_status === "verified").length,
    rejected: payments.filter((p) => p.newton_status === "rejected").length,
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600, color: "#0a1f44" }}>
          Payments
        </h2>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.88rem", color: "#6b7280" }}>
          E-Transfer submissions from Nimmi clients — verify or reject.
        </p>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {(["all", "pending", "verified", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "0.5rem 1rem",
              background: filter === f ? "#0a1f44" : "white",
              color: filter === f ? "white" : "#0a1f44",
              border: "1px solid #e4e4e7",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f} {filter === f ? "" : `(${counts[f]})`}
          </button>
        ))}
        <button
          onClick={load}
          style={{
            padding: "0.5rem 1rem",
            background: "white",
            color: "#0a1f44",
            border: "1px solid #e4e4e7",
            borderRadius: "8px",
            fontSize: "0.85rem",
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* List */}
      {loading ? (
        <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>Loading…</p>
      ) : payments.length === 0 ? (
        <div
          style={{
            padding: "3rem 1.5rem",
            textAlign: "center",
            border: "1px dashed #e4e4e7",
            borderRadius: "12px",
          }}
        >
          <p style={{ fontSize: "2rem", margin: 0 }}>💳</p>
          <p style={{ fontSize: "0.95rem", color: "#6b7280", margin: "0.5rem 0 0" }}>
            No {filter !== "all" ? filter : ""} payments yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {payments.map((p) => {
            const statusColor = {
              pending: { bg: "#fef3c7", fg: "#92400e", border: "#fde68a" },
              verified: { bg: "#d1fae5", fg: "#065f46", border: "#a7f3d0" },
              rejected: { bg: "#fee2e2", fg: "#991b1b", border: "#fecaca" },
              refunded: { bg: "#e0e7ff", fg: "#3730a3", border: "#c7d2fe" },
            }[p.newton_status];

            const scanColor = {
              verified: { bg: "#d1fae5", fg: "#065f46" },
              flagged: { bg: "#fef3c7", fg: "#92400e" },
              failed: { bg: "#fee2e2", fg: "#991b1b" },
              pending: { bg: "#f3f4f6", fg: "#6b7280" },
            }[p.scan_status || "pending"] || { bg: "#f3f4f6", fg: "#6b7280" };

            const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
            const services = Array.isArray(p.services) ? p.services : [];

            return (
              <div
                key={p.id}
                style={{
                  background: "white",
                  border: "1px solid #e4e4e7",
                  borderRadius: "12px",
                  padding: "1.25rem 1.5rem",
                }}
              >
                {/* Top row: name + status */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: "0.85rem",
                    gap: "1rem",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "1rem", fontWeight: 600, color: "#0a1f44" }}>
                      {fullName}
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#6b7280", marginTop: "0.15rem" }}>
                      {p.email}
                      {p.phone && ` · ${p.phone}`}
                    </div>
                    {p.payment_reference && (
                      <code
                        style={{
                          display: "inline-block",
                          marginTop: "0.4rem",
                          fontSize: "0.78rem",
                          background: "#f3f4f6",
                          color: "#374151",
                          padding: "0.15rem 0.45rem",
                          borderRadius: "4px",
                          fontWeight: 600,
                        }}
                      >
                        {p.payment_reference}
                      </code>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem" }}>
                    <span
                      style={{
                        fontSize: "1.3rem",
                        fontWeight: 600,
                        color: "#0a1f44",
                      }}
                    >
                      {fmtCurrency(p.final_amount)}
                    </span>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        padding: "0.2rem 0.6rem",
                        borderRadius: "4px",
                        background: statusColor.bg,
                        color: statusColor.fg,
                        border: `1px solid ${statusColor.border}`,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {p.newton_status}
                    </span>
                  </div>
                </div>

                {/* Services */}
                <div
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #f3f4f6",
                    borderRadius: "8px",
                    padding: "0.75rem 1rem",
                    marginBottom: "0.85rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 600,
                      color: "#9ca3af",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: "0.5rem",
                    }}
                  >
                    Services ({services.length})
                  </div>
                  {services.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.85rem",
                        color: "#374151",
                        padding: "0.2rem 0",
                      }}
                    >
                      <span>{s.name}</span>
                      <span style={{ color: "#6b7280" }}>${s.basePrice.toFixed(2)}</span>
                    </div>
                  ))}
                  <div
                    style={{
                      borderTop: "1px solid #e5e7eb",
                      marginTop: "0.4rem",
                      paddingTop: "0.4rem",
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.78rem",
                      color: "#6366f1",
                      fontWeight: 500,
                    }}
                  >
                    <span>Nimmi 10% discount</span>
                    <span>−{fmtCurrency(p.discount_amount)}</span>
                  </div>
                </div>

                {/* AI scan results */}
                {p.scan_status && (
                  <div style={{ marginBottom: "0.85rem" }}>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        padding: "0.2rem 0.55rem",
                        borderRadius: "4px",
                        background: scanColor.bg,
                        color: scanColor.fg,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      AI scan: {p.scan_status}
                    </span>
                    {p.scan_detected_amount && (
                      <span style={{ fontSize: "0.82rem", color: "#6b7280", marginLeft: "0.6rem" }}>
                        detected {fmtCurrency(p.scan_detected_amount)}
                      </span>
                    )}
                    {p.scan_detected_recipient && (
                      <span style={{ fontSize: "0.78rem", color: "#6b7280", marginLeft: "0.6rem" }}>
                        → {p.scan_detected_recipient}
                      </span>
                    )}
                    {p.scan_notes && (
                      <div
                        style={{
                          marginTop: "0.4rem",
                          fontSize: "0.8rem",
                          color: "#92400e",
                          background: "#fef3c7",
                          padding: "0.4rem 0.7rem",
                          borderRadius: "6px",
                          borderLeft: "3px solid #f59e0b",
                          whiteSpace: "pre-line",
                        }}
                      >
                        {p.scan_notes}
                      </div>
                    )}
                  </div>
                )}

                {/* Timestamp + verifier info */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.78rem",
                    color: "#9ca3af",
                    marginBottom: "0.85rem",
                  }}
                >
                  <span>Received {fmtDate(p.received_at)}</span>
                  {p.newton_verified_at && (
                    <span>
                      {p.newton_status} by {p.newton_verified_by} · {fmtDate(p.newton_verified_at)}
                    </span>
                  )}
                </div>

                {/* Action buttons */}
                {p.newton_status === "pending" && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => updateStatus(p.id, "verified")}
                      disabled={updating === p.id}
                      style={{
                        flex: 1,
                        padding: "0.6rem 1rem",
                        background: "#059669",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        fontWeight: 500,
                        cursor: updating === p.id ? "wait" : "pointer",
                      }}
                    >
                      ✓ Verify payment
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Reject this payment? Client will need to resubmit.")) {
                          updateStatus(p.id, "rejected");
                        }
                      }}
                      disabled={updating === p.id}
                      style={{
                        flex: 1,
                        padding: "0.6rem 1rem",
                        background: "white",
                        color: "#dc2626",
                        border: "1px solid #fecaca",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        fontWeight: 500,
                        cursor: updating === p.id ? "wait" : "pointer",
                      }}
                    >
                      ✕ Reject
                    </button>
                  </div>
                )}

                {p.newton_status === "verified" && (
                  <button
                    onClick={() => {
                      if (confirm("Mark as refunded? Used for cancellations.")) {
                        updateStatus(p.id, "refunded");
                      }
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "white",
                      color: "#6b7280",
                      border: "1px solid #e4e4e7",
                      borderRadius: "6px",
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    Mark as refunded
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
