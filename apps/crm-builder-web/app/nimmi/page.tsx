'use client';

import { useEffect, useState } from 'react';
import { PaymentsTab } from './PaymentsTab';

/**
 * Nimmi admin page — with Convert to Case + Download buttons.
 *
 * URL: /nimmi
 * Auth: relies on existing fd_session cookie (CRM session)
 */

type Tab = 'signups' | 'callbacks' | 'intakes' | 'documents' | 'payments';

const COMMON_FORM_TYPES = [
  'PGWP',
  'Study Permit Extension',
  'Express Entry',
  'PNP',
  'Spousal Sponsorship',
  'Visitor Visa',
  'Super Visa',
  'PR Card Renewal',
  'Citizenship',
  'PR Strategy Consultation',
  'Work Permit',
];

interface SignupRow {
  id: number;
  nimmi_user_id: string;
  email: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  signed_up_at: string;
  handled: boolean;
  handled_by: string | null;
  converted_case_id: string | null;
  notes: string | null;
}
interface CallbackRow {
  id: number;
  nimmi_callback_id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  service_slug: string | null;
  preferred_time: string | null;
  preferred_contact: string | null;
  message: string | null;
  created_at_nimmi: string;
  status: string;
  handled_by: string | null;
  notes: string | null;
  converted_case_id: string | null;
}
interface IntakeRow {
  id: number;
  nimmi_intake_id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  service_slug: string;
  eligible: boolean;
  ineligible_reason: string | null;
  answers: unknown;
  created_at_nimmi: string;
  handled: boolean;
  handled_by: string | null;
  notes: string | null;
  converted_case_id: string | null;
}
interface DocumentRow {
  id: number;
  nimmi_document_id: string;
  nimmi_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  category: string | null;
  display_name: string | null;
  original_filename: string | null;
  share_note: string | null;
  shared_at: string;
}

export default function NimmiAdminPage() {
  const [tab, setTab] = useState<Tab>('signups');
  const [authError, setAuthError] = useState(false);

  return (
    <div style={{ minHeight: '100vh', background: '#fafaf9', color: '#111', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <nav style={{ background: 'white', borderBottom: '1px solid #e5e5e5', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '1.35rem', fontWeight: 500 }}>Nimmi</span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', padding: '0.2rem 0.5rem', background: '#2563eb', color: 'white', borderRadius: '4px', textTransform: 'uppercase' }}>Newton Admin</span>
        </div>
        <a href="/" style={{ fontSize: '0.85rem', color: '#525252', textDecoration: 'none' }}>← Back to CRM</a>
      </nav>

      <div style={{ background: 'white', borderBottom: '1px solid #e5e5e5', padding: '0 1.5rem', display: 'flex', gap: '0.25rem', overflowX: 'auto' }}>
        <TabBtn active={tab === 'signups'} onClick={() => setTab('signups')}>Signups</TabBtn>
        <TabBtn active={tab === 'callbacks'} onClick={() => setTab('callbacks')}>Callbacks</TabBtn>
        <TabBtn active={tab === 'intakes'} onClick={() => setTab('intakes')}>Eligibility</TabBtn>
        <TabBtn active={tab === 'documents'} onClick={() => setTab('documents')}>Documents</TabBtn>
        <TabBtn active={tab === 'payments'} onClick={() => setTab('payments')}>Payments</TabBtn>
      </div>

      {authError && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#9a2e10' }}>
          You're not signed in to the CRM. <a href="/">Sign in →</a>
        </div>
      )}

      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '1.5rem' }}>
        {tab === 'signups' && <SignupsTab onAuthError={() => setAuthError(true)} />}
        {tab === 'callbacks' && <CallbacksTab onAuthError={() => setAuthError(true)} />}
        {tab === 'intakes' && <IntakesTab onAuthError={() => setAuthError(true)} />}
        {tab === 'documents' && <DocumentsTab onAuthError={() => setAuthError(true)} />}
        {tab === 'payments' && <PaymentsTab />}
      </main>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.85rem 1.1rem',
        fontSize: '0.88rem',
        fontWeight: 500,
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
        color: active ? '#111' : '#737373',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ─── CONVERT DIALOG ──────────────────────────────────────────

function ConvertDialog({
  rowName,
  defaultFormType,
  onClose,
  onConvert,
}: {
  rowName: string;
  defaultFormType?: string;
  onClose: () => void;
  onConvert: (formType: string, assignedTo: string) => Promise<void>;
}) {
  const [formType, setFormType] = useState(defaultFormType || 'PR Strategy Consultation');
  const [customFormType, setCustomFormType] = useState('');
  const [assignedTo, setAssignedTo] = useState('Unassigned');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert() {
    setSubmitting(true);
    setError(null);
    try {
      const finalFormType = formType === '__custom' ? customFormType.trim() : formType;
      if (!finalFormType) {
        setError('Please pick or type a form type');
        setSubmitting(false);
        return;
      }
      await onConvert(finalFormType, assignedTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: '12px',
          padding: '1.75rem',
          width: '100%',
          maxWidth: '440px',
          boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.2rem', fontWeight: 600 }}>Convert to Case</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.88rem', color: '#525252' }}>
          Creating a real CRM case for <strong>{rowName}</strong>
        </p>

        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, marginBottom: '0.4rem' }}>Form type</label>
        <select
          value={formType}
          onChange={(e) => setFormType(e.target.value)}
          style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #d4d4d4', borderRadius: '6px', fontSize: '0.9rem', marginBottom: '0.85rem', background: 'white' }}
        >
          {COMMON_FORM_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
          <option value="__custom">Custom…</option>
        </select>

        {formType === '__custom' && (
          <input
            type="text"
            value={customFormType}
            onChange={(e) => setCustomFormType(e.target.value)}
            placeholder="Custom form type"
            style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #d4d4d4', borderRadius: '6px', fontSize: '0.9rem', marginBottom: '0.85rem' }}
          />
        )}

        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, marginBottom: '0.4rem' }}>Assign to</label>
        <input
          type="text"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          placeholder="Unassigned"
          style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #d4d4d4', borderRadius: '6px', fontSize: '0.9rem', marginBottom: '1.25rem' }}
        />

        {error && <p style={{ fontSize: '0.82rem', color: '#9a2e10', marginBottom: '0.85rem' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={submitting} style={{ padding: '0.6rem 1rem', border: '1px solid #d4d4d4', background: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.88rem' }}>Cancel</button>
          <button onClick={handleConvert} disabled={submitting} style={{ padding: '0.6rem 1rem', border: 'none', background: '#0a0a0a', color: 'white', borderRadius: '6px', cursor: submitting ? 'wait' : 'pointer', fontSize: '0.88rem', fontWeight: 500 }}>
            {submitting ? 'Converting…' : 'Create case →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SIGNUPS ─────────────────────────────────────────────────

function SignupsTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<SignupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'handled'>('all');
  const [convertingRow, setConvertingRow] = useState<SignupRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const handled = filter === 'pending' ? '0' : filter === 'handled' ? '1' : '';
      const res = await fetch(`/api/nimmi/signups${handled ? `?handled=${handled}` : ''}`);
      if (res.status === 401) { onAuthError(); return; }
      const data = await res.json();
      setRows(data.rows || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [filter]);

  async function markHandled(id: number, handled: boolean) {
    await fetch(`/api/nimmi/signups?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handled }),
    });
    void refresh();
  }

  async function handleConvert(row: SignupRow, formType: string, assignedTo: string) {
    const res = await fetch(`/api/nimmi/signups/${row.id}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formType, assignedTo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Convert failed');
    setConvertingRow(null);
    alert(`✓ Created case ${data.case_id}`);
    void refresh();
  }

  return (
    <div>
      <FilterBar
        options={[
          { value: 'all', label: 'All' },
          { value: 'pending', label: 'Not handled' },
          { value: 'handled', label: 'Handled' },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as 'all' | 'pending' | 'handled')}
        count={rows.length}
        loading={loading}
      />

      <div style={{ background: 'white', border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f4', textAlign: 'left' }}>
              <Th>Signed up</Th>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#737373' }}>No signups yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f5f5f4' }}>
                <Td>{formatDate(r.signed_up_at)}</Td>
                <Td><strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</strong></Td>
                <Td>{r.email}</Td>
                <Td>{r.phone || '—'}</Td>
                <Td>
                  {r.converted_case_id ? (
                    <span style={{ fontSize: '0.75rem', background: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>→ {r.converted_case_id}</span>
                  ) : r.handled ? (
                    <span style={{ fontSize: '0.75rem', background: '#dff4ec', color: '#0a6e54', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>✓ Handled</span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#854d0e', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>! New</span>
                  )}
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {!r.converted_case_id && (
                      <button onClick={() => setConvertingRow(r)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', border: '1px solid #2563eb', background: '#2563eb', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}>Convert to Case</button>
                    )}
                    <button onClick={() => markHandled(r.id, !r.handled)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', border: '1px solid #d4d4d4', borderRadius: '4px', background: 'white', cursor: 'pointer' }}>
                      {r.handled ? 'Mark pending' : 'Mark handled'}
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {convertingRow && (
        <ConvertDialog
          rowName={[convertingRow.first_name, convertingRow.last_name].filter(Boolean).join(' ') || convertingRow.email}
          onClose={() => setConvertingRow(null)}
          onConvert={(formType, assignedTo) => handleConvert(convertingRow, formType, assignedTo)}
        />
      )}
    </div>
  );
}

// ─── CALLBACKS ───────────────────────────────────────────────

function CallbacksTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<CallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [convertingRow, setConvertingRow] = useState<CallbackRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const status = filter === 'pending' ? 'pending' : filter === 'done' ? 'done' : '';
      const res = await fetch(`/api/nimmi/callbacks${status ? `?status=${status}` : ''}`);
      if (res.status === 401) { onAuthError(); return; }
      const data = await res.json();
      setRows(data.rows || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [filter]);

  async function markStatus(id: number, status: string) {
    await fetch(`/api/nimmi/callbacks?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    void refresh();
  }

  async function handleConvert(row: CallbackRow, formType: string, assignedTo: string) {
    const res = await fetch(`/api/nimmi/callbacks/${row.id}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formType, assignedTo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Convert failed');
    setConvertingRow(null);
    alert(`✓ Created case ${data.case_id}`);
    void refresh();
  }

  return (
    <div>
      <FilterBar
        options={[
          { value: 'all', label: 'All' },
          { value: 'pending', label: 'Pending' },
          { value: 'done', label: 'Done' },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as 'all' | 'pending' | 'done')}
        count={rows.length}
        loading={loading}
      />

      <div style={{ background: 'white', border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f4', textAlign: 'left' }}>
              <Th>Requested</Th>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Service</Th>
              <Th>Time</Th>
              <Th>Message</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#737373' }}>No callbacks yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f5f5f4' }}>
                <Td>{formatDate(r.created_at_nimmi)}</Td>
                <Td><strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</strong></Td>
                <Td>{r.phone || r.email || '—'}</Td>
                <Td>{r.service_slug || '—'}</Td>
                <Td>{r.preferred_time || '—'}</Td>
                <Td style={{ maxWidth: 200 }}>{r.message || '—'}</Td>
                <Td>
                  {r.converted_case_id ? (
                    <span style={{ fontSize: '0.75rem', background: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>→ {r.converted_case_id}</span>
                  ) : (
                    <select value={r.status} onChange={(e) => markStatus(r.id, e.target.value)} style={{ fontSize: '0.78rem', padding: '0.25rem', border: '1px solid #d4d4d4', borderRadius: '4px', background: 'white' }}>
                      <option value="pending">Pending</option>
                      <option value="contacted">Contacted</option>
                      <option value="done">Done</option>
                      <option value="no_answer">No answer</option>
                    </select>
                  )}
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    {r.phone && (
                      <a href={`tel:${r.phone}`} style={{ fontSize: '0.78rem', padding: '0.3rem 0.55rem', border: '1px solid #d4d4d4', background: 'white', borderRadius: '4px', textDecoration: 'none', color: '#0a0a0a' }}>📞</a>
                    )}
                    {!r.converted_case_id && (
                      <button onClick={() => setConvertingRow(r)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', border: '1px solid #2563eb', background: '#2563eb', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}>Convert</button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {convertingRow && (
        <ConvertDialog
          rowName={[convertingRow.first_name, convertingRow.last_name].filter(Boolean).join(' ') || convertingRow.phone || convertingRow.email || 'Lead'}
          defaultFormType={convertingRow.service_slug ? slugToFormType(convertingRow.service_slug) : undefined}
          onClose={() => setConvertingRow(null)}
          onConvert={(formType, assignedTo) => handleConvert(convertingRow, formType, assignedTo)}
        />
      )}
    </div>
  );
}

// ─── INTAKES ─────────────────────────────────────────────────

function IntakesTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'eligible' | 'ineligible'>('all');
  const [convertingRow, setConvertingRow] = useState<IntakeRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const eligible = filter === 'eligible' ? '1' : filter === 'ineligible' ? '0' : '';
      const res = await fetch(`/api/nimmi/intakes${eligible ? `?eligible=${eligible}` : ''}`);
      if (res.status === 401) { onAuthError(); return; }
      const data = await res.json();
      setRows(data.rows || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [filter]);

  async function markHandled(id: number, handled: boolean) {
    await fetch(`/api/nimmi/intakes?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handled }),
    });
    void refresh();
  }

  async function handleConvert(row: IntakeRow, formType: string, assignedTo: string) {
    const res = await fetch(`/api/nimmi/intakes/${row.id}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formType, assignedTo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Convert failed');
    setConvertingRow(null);
    alert(`✓ Created case ${data.case_id}`);
    void refresh();
  }

  return (
    <div>
      <FilterBar
        options={[
          { value: 'all', label: 'All' },
          { value: 'eligible', label: 'Qualified ✓' },
          { value: 'ineligible', label: "Didn't qualify" },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as 'all' | 'eligible' | 'ineligible')}
        count={rows.length}
        loading={loading}
      />

      <div style={{ background: 'white', border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f4', textAlign: 'left' }}>
              <Th>Submitted</Th>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Service</Th>
              <Th>Result</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#737373' }}>No eligibility submissions yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f5f5f4' }}>
                <Td>{formatDate(r.created_at_nimmi)}</Td>
                <Td><strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</strong></Td>
                <Td>{r.email || '—'}</Td>
                <Td><code style={{ fontSize: '0.78rem' }}>{r.service_slug}</code></Td>
                <Td>
                  {r.eligible ? (
                    <span style={{ fontSize: '0.75rem', background: '#dff4ec', color: '#0a6e54', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>✓ Qualifies</span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', background: '#fce8e3', color: '#9a2e10', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>Doesn't qualify</span>
                  )}
                </Td>
                <Td>
                  {r.converted_case_id ? (
                    <span style={{ fontSize: '0.75rem', background: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>→ {r.converted_case_id}</span>
                  ) : r.handled ? (
                    <span style={{ fontSize: '0.75rem', color: '#0a6e54' }}>✓ Handled</span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: '#854d0e' }}>! Pending</span>
                  )}
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {!r.converted_case_id && (
                      <button onClick={() => setConvertingRow(r)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', border: '1px solid #2563eb', background: '#2563eb', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}>Convert</button>
                    )}
                    <button onClick={() => markHandled(r.id, !r.handled)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', border: '1px solid #d4d4d4', borderRadius: '4px', background: 'white', cursor: 'pointer' }}>
                      {r.handled ? 'Pending' : 'Handled'}
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {convertingRow && (
        <ConvertDialog
          rowName={[convertingRow.first_name, convertingRow.last_name].filter(Boolean).join(' ') || convertingRow.email || 'Lead'}
          defaultFormType={slugToFormType(convertingRow.service_slug)}
          onClose={() => setConvertingRow(null)}
          onConvert={(formType, assignedTo) => handleConvert(convertingRow, formType, assignedTo)}
        />
      )}
    </div>
  );
}

// ─── DOCUMENTS (NOW WITH DOWNLOAD BUTTON) ────────────────────

function DocumentsTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/nimmi/documents`);
      if (res.status === 401) { onAuthError(); return; }
      const data = await res.json();
      setRows(data.rows || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function handleDownload(row: DocumentRow) {
    setDownloadingId(row.id);
    try {
      const res = await fetch(`/api/nimmi/documents/${row.id}/download`);
      const data = await res.json();
      if (!res.ok) {
        alert(`Download failed: ${data.error || 'Unknown error'}`);
        return;
      }
      if (data.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
      } else {
        alert('No download URL returned');
      }
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <FilterBar options={[]} value="" onChange={() => {}} count={rows.length} loading={loading} />

      <div style={{ background: 'white', border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f4', textAlign: 'left' }}>
              <Th>Shared</Th>
              <Th>From</Th>
              <Th>Email</Th>
              <Th>Category</Th>
              <Th>Filename</Th>
              <Th>Note</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#737373' }}>No documents shared yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f5f5f4' }}>
                <Td>{formatDate(r.shared_at)}</Td>
                <Td><strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</strong></Td>
                <Td>{r.email || '—'}</Td>
                <Td><code style={{ fontSize: '0.78rem' }}>{r.category || 'general'}</code></Td>
                <Td>{r.display_name || r.original_filename || '—'}</Td>
                <Td style={{ maxWidth: 220 }}>{r.share_note || '—'}</Td>
                <Td>
                  <button
                    onClick={() => handleDownload(r)}
                    disabled={downloadingId === r.id}
                    style={{
                      fontSize: '0.78rem',
                      padding: '0.3rem 0.8rem',
                      border: '1px solid #2563eb',
                      background: downloadingId === r.id ? '#dbeafe' : '#2563eb',
                      color: downloadingId === r.id ? '#1e40af' : 'white',
                      borderRadius: '4px',
                      cursor: downloadingId === r.id ? 'wait' : 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {downloadingId === r.id ? 'Loading…' : '↓ Download'}
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────

function slugToFormType(slug: string): string {
  const map: Record<string, string> = {
    pgwp: 'PGWP',
    'study-permit-extension': 'Study Permit Extension',
    'express-entry': 'Express Entry',
    pnp: 'PNP',
    'spousal-sponsorship-inside': 'Spousal Sponsorship',
    'visitor-visa': 'Visitor Visa',
    'pr-card-renewal': 'PR Card Renewal',
    citizenship: 'Citizenship',
    consultation: 'PR Strategy Consultation',
  };
  return map[slug] || slug;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '0.75rem 1rem', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#737373' }}>{children}</th>;
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '0.75rem 1rem', verticalAlign: 'top', ...style }}>{children}</td>;
}

function FilterBar({ options, value, onChange, count, loading }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  count: number;
  loading: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '0.4rem 0.85rem',
              fontSize: '0.82rem',
              fontWeight: 500,
              background: value === opt.value ? '#0a0a0a' : 'white',
              color: value === opt.value ? 'white' : '#525252',
              border: '1px solid ' + (value === opt.value ? '#0a0a0a' : '#d4d4d4'),
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <span style={{ fontSize: '0.78rem', color: '#737373' }}>
        {loading ? 'Loading…' : `${count} row${count === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 1) return `${Math.round(diffMs / (1000 * 60))}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}
