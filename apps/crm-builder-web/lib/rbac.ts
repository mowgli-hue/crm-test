import { Role } from "@/lib/models";

export type AppScreen =
  | "dashboard"
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
  | "marketing-inbox"
  | "marketing-leads"
  | "marketing-dashboard"
  | "call-log"
  | "newton-ai";

// Each role only sees what they need
const STAFF_ROLE_TAB_ACCESS: Record<Exclude<Role, "Client">, AppScreen[]> = {
  // Admin sees everything
  Admin: ["dashboard", "cases", "communications", "results", "submission", "accounting", "tasks", "inbox", "marketing-inbox", "marketing-leads", "marketing-dashboard", "call-log", "team", "settings", "newton-ai"],

  // Marketing creates cases, tracks leads, logs calls, sees accounting
  Marketing: ["dashboard", "cases", "communications", "tasks", "inbox", "marketing-inbox", "marketing-leads", "marketing-dashboard", "call-log", "team", "newton-ai"],

  // Processing works cases assigned to them — no need to create cases or see accounting
  Processing: ["dashboard", "cases", "submission", "tasks", "inbox", "team", "newton-ai"],

  // Processing Lead can also see results and reassign
  ProcessingLead: ["dashboard", "cases", "results", "submission", "tasks", "inbox", "team", "settings", "newton-ai"],

  // Reviewer just reviews cases
  Reviewer: ["dashboard", "cases", "tasks", "inbox", "team", "newton-ai"],
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
  return r === "Admin";
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
