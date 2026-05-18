'use client';

import { useEffect, useState } from 'react';

/**
 * Nimmi admin page — standalone, doesn't depend on simple-shell.
 *
 * URL: /nimmi
 * Auth: relies on existing fd_session cookie (CRM session)
 *
 * If the user isn't signed in to CRM, the API calls will 401 and we
 * show a "please sign in to CRM first" message.
 *
 * Newton team can bookmark this URL or you can add a sidebar link later.
 */

type Tab = 'signups' | 'callbacks' | 'intakes' | 'documents';

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
      {/* Top nav */}
      <nav style={{ background: 'white', borderBottom: '1px solid #e5e5e5', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '1.35rem', fontWeight: 500 }}>Nimmi</span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', padding: '0.2rem 0.5rem', background: '#0e5550', color: 'white', borderRadius: '4px', textTransform: 'uppercase' }}>Newton Admin</span>
        </div>
        <a href="/" style={{ fontSize: '0.85rem', color: '#525252', textDecoration: 'none' }}>← Back to CRM</a>
      </nav>

      {/* Tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid #e5e5e5', padding: '0 1.5rem', display: 'flex', gap: '0.25rem', overflowX: 'auto' }}>
        <TabBtn active={tab === 'signups'} onClick={() => setTab('signups')}>Signups</TabBtn>
        <TabBtn active={tab === 'callbacks'} onClick={() => setTab('callbacks')}>Callbacks</TabBtn>
        <TabBtn active={tab === 'intakes'} onClick={() => setTab('intakes')}>Eligibility</TabBtn>
        <TabBtn active={tab === 'documents'} onClick={() => setTab('documents')}>Documents</TabBtn>
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
        borderBottom: active ? '2px solid #0e5550' : '2px solid transparent',
        color: active ? '#111' : '#737373',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ─── SIGNUPS ─────────────────────────────────────────────────

function SignupsTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<SignupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'handled'>('all');

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
              <Th></Th>
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
                  {r.handled ? (
                    <span style={{ fontSize: '0.75rem', background: '#dff4ec', color: '#0a6e54', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                      ✓ Handled
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#854d0e', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                      ! New
                    </span>
                  )}
                </Td>
                <Td>
                  <button onClick={() => markHandled(r.id, !r.handled)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', border: '1px solid #d4d4d4', borderRadius: '4px', background: 'white', cursor: 'pointer' }}>
                    {r.handled ? 'Mark pending' : 'Mark handled'}
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

// ─── CALLBACKS ───────────────────────────────────────────────

function CallbacksTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<CallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');

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
              <Th>Preferred time</Th>
              <Th>Message</Th>
              <Th>Status</Th>
              <Th></Th>
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
                <Td style={{ maxWidth: 220 }}>{r.message || '—'}</Td>
                <Td>
                  <select value={r.status} onChange={(e) => markStatus(r.id, e.target.value)} style={{ fontSize: '0.78rem', padding: '0.25rem', border: '1px solid #d4d4d4', borderRadius: '4px', background: 'white' }}>
                    <option value="pending">Pending</option>
                    <option value="contacted">Contacted</option>
                    <option value="done">Done</option>
                    <option value="no_answer">No answer</option>
                  </select>
                </Td>
                <Td>
                  {r.phone && (
                    <a href={`tel:${r.phone}`} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', border: '1px solid #0e5550', background: '#0e5550', color: 'white', borderRadius: '4px', textDecoration: 'none' }}>
                      📞 Call
                    </a>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── INTAKES ─────────────────────────────────────────────────

function IntakesTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'eligible' | 'ineligible'>('all');

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
              <Th></Th>
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
                  {r.handled ? (
                    <span style={{ fontSize: '0.75rem', color: '#0a6e54' }}>✓ Handled</span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: '#854d0e' }}>! Pending</span>
                  )}
                </Td>
                <Td>
                  <button onClick={() => markHandled(r.id, !r.handled)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', border: '1px solid #d4d4d4', borderRadius: '4px', background: 'white', cursor: 'pointer' }}>
                    {r.handled ? 'Mark pending' : 'Mark handled'}
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

// ─── DOCUMENTS ───────────────────────────────────────────────

function DocumentsTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);

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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#737373' }}>No documents shared yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f5f5f4' }}>
                <Td>{formatDate(r.shared_at)}</Td>
                <Td><strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</strong></Td>
                <Td>{r.email || '—'}</Td>
                <Td><code style={{ fontSize: '0.78rem' }}>{r.category || 'general'}</code></Td>
                <Td>{r.display_name || r.original_filename || '—'}</Td>
                <Td style={{ maxWidth: 220 }}>{r.share_note || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ padding: '1rem', fontSize: '0.78rem', color: '#737373', fontStyle: 'italic', background: '#fafaf9', borderTop: '1px solid #f5f5f4' }}>
          Note: To download a document, a Newton specialist signs in to Nimmi and clicks "Download" on the document detail page. Direct download from CRM coming soon.
        </p>
      </div>
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────

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
              background: value === opt.value ? '#111' : 'white',
              color: value === opt.value ? 'white' : '#525252',
              border: '1px solid ' + (value === opt.value ? '#111' : '#d4d4d4'),
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
