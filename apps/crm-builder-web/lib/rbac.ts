import { Role } from "@/lib/models";

export type AppScreen =
  | "dashboard"
  | "admin-dashboard"
  | "cases"
  | "communications"
  | "results"
  | "submission"
  | "settings"
  | "accounting"
  | "tasks"
  | "chat"
  | "files"
  | "team"
  | "inbox"
  | "web-forms"
  | "pr-consultations"
  | "marketing-inbox"
  | "marketing-leads"
  | "marketing-dashboard"
  | "call-log"
  | "agent"
  | "tracking"
  | "newton-ai";

// Each role only sees what they need
const STAFF_ROLE_TAB_ACCESS: Record<Exclude<Role, "Client">, AppScreen[]> = {
  // Admin sees everything
  Admin: ["dashboard", "admin-dashboard", "agent", "cases", "communications", "results", "submission", "tracking", "accounting", "tasks", "inbox", "web-forms", "marketing-inbox", "marketing-leads", "marketing-dashboard", "call-log", "team", "settings", "newton-ai"],

  // Marketing = the office-management circle (Manpreet, Neha). They run leads,
  // and per Newton policy also see Team, Settings, and Accounting alongside the
  // owner. Everyone below this is rank-and-file processing/review staff and does
  // NOT see those management screens.
  Marketing: ["dashboard", "cases", "communications", "tasks", "inbox", "marketing-inbox", "marketing-leads", "marketing-dashboard", "call-log", "team", "settings", "accounting", "newton-ai"],

  // Processing works only cases assigned to them — no team list, no settings, no accounting.
  Processing: ["dashboard", "cases", "submission", "tasks", "inbox", "web-forms", "newton-ai"],

  // Processing Lead can also see results and reassign — but not the management screens.
  ProcessingLead: ["dashboard", "agent", "cases", "results", "submission", "tracking", "tasks", "inbox", "web-forms", "newton-ai"],

  // Reviewer reviews cases — under-review queue, submissions, results. No management screens.
  Reviewer: ["dashboard", "cases", "submission", "results", "tracking", "tasks", "inbox", "newton-ai"],
};

function normalizeRole(role: Role | string): Role {
  const value = String(role || "").trim().toLowerCase();
  if (value === "admin") return "Admin";
  if (value === "marketing") return "Marketing";
  if (value === "processing") return "Processing";
  if (value === "processinglead" || value === "processing lead") return "ProcessingLead";
  if (value === "reviewer") return "Reviewer";
  if (value === "client") return "Client";
  return "Client";
}

export function isStaffRole(role: Role): role is Exclude<Role, "Client"> {
  return normalizeRole(role) !== "Client";
}

export function tabsForRole(role: Role): AppScreen[] {
  const normalized = normalizeRole(role);
  if (normalized === "Client") return [];
  return STAFF_ROLE_TAB_ACCESS[normalized];
}

export function canManageUsers(role: Role): boolean {
  return normalizeRole(role) === "Admin";
}

export function canCreateCase(role: Role): boolean {
  const r = normalizeRole(role);
  return r === "Admin" || r === "Marketing";
}

export function canUseAccounting(role: Role): boolean {
  const r = normalizeRole(role);
  // Owner (Admin) + office-management (Marketing: Manpreet, Neha). Rank-and-file
  // processing/review staff never see accounting.
  return r === "Admin" || r === "Marketing";
}

export function canUseCommunications(role: Role): boolean {
  const r = normalizeRole(role);
  return r === "Admin" || r === "Marketing";
}

export function canAssignCases(role: Role): boolean {
  const r = normalizeRole(role);
  return r === "Admin" || r === "ProcessingLead";
}

export function canChangeStatus(role: Role): boolean {
  const r = normalizeRole(role);
  return r === "Admin" || r === "Processing" || r === "ProcessingLead" || r === "Reviewer";
}

function normalize(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isCaseAssignedToUser(assignedTo: string | undefined, userName: string): boolean {
  const assigned = normalize(assignedTo || "");
  const user = normalize(userName || "");
  if (!assigned || assigned === "unassigned" || !user) return false;
  if (assigned === user) return true;
  return user.includes(assigned) || assigned.includes(user);
}

// True for roles that see the whole book (Admin/Marketing/ProcessingLead/Reviewer).
// Processing staff are scoped to their own assigned cases. Mirrors the access
// branch in canStaffAccessCase — use this for team-wide vs own-only views.
export function canSeeAllCases(role: Role): boolean {
  const r = normalizeRole(role);
  return r === "Admin" || r === "Marketing" || r === "ProcessingLead" || r === "Reviewer";
}

// Processing staff only see their own assigned cases
// Admin/Marketing/Reviewer see all
export function canStaffAccessCase(role: Role, userName: string, caseAssignedTo?: string): boolean {
  const normalized = normalizeRole(role);
  if (normalized === "Client") return false;

  // Admin, Marketing, ProcessingLead, Reviewer see all cases
  if (normalized === "Admin" || normalized === "Marketing" || normalized === "ProcessingLead" || normalized === "Reviewer") {
    return true;
  }

  // Processing staff only see their own cases
  if (normalized === "Processing") {
    if (!caseAssignedTo || caseAssignedTo === "Unassigned") return false;
    return isCaseAssignedToUser(caseAssignedTo, userName);
  }

  return true;
}
