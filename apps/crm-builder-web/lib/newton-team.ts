import { Role } from "@/lib/models";

export type NewtonTeamMember = {
  name: string;
  email: string;
  role: Role;
  workspaceDriveLink: string;
  workspaceDriveFolderId?: string;
};

function extractDriveFolderId(link: string): string | undefined {
  const value = String(link || "").trim();
  if (!value) return undefined;
  const byFolders = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (byFolders?.[1]) return byFolders[1];
  const byId = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return byId?.[1];
}

const ROOT_DRIVE = "https://drive.google.com/drive/folders/1FAjuG-Uj4fhp9zWfVsiHoX8WbVPT_r7j?usp=drive_link";

const RAW_TEAM_MEMBERS: Omit<NewtonTeamMember, "workspaceDriveFolderId">[] = [
  { name: "Lavisha Dhingra",  email: "lavisha.newtonimmigration@gmail.com",      role: "Admin",          workspaceDriveLink: ROOT_DRIVE },
  { name: "Rapneet Kaur",     email: "rapneetkaur.newtonimmigration@gmail.com",  role: "Processing",     workspaceDriveLink: ROOT_DRIVE },
  { name: "Rajwinder Kaur",   email: "rajwinder.newtonimmigration@gmail.com",    role: "Processing",     workspaceDriveLink: ROOT_DRIVE },
  { name: "Avneet Kaur",      email: "avneet.newtonimmigration@gmail.com",       role: "Processing",     workspaceDriveLink: ROOT_DRIVE },
  { name: "Ramandeep Kaur",   email: "ramandeep.newtonimmigration@gmail.com",    role: "ProcessingLead", workspaceDriveLink: ROOT_DRIVE },
  { name: "Simi Das",         email: "simi.newtonimmigration@gmail.com",         role: "Processing",     workspaceDriveLink: ROOT_DRIVE },
  { name: "Manisha",          email: "manisha.newtonimmigration@gmail.com",      role: "Processing",     workspaceDriveLink: ROOT_DRIVE },
  { name: "Sukhman Kaur",     email: "sukhman.newtonimmigration@gmail.com",      role: "Processing",     workspaceDriveLink: ROOT_DRIVE },
  { name: "Serbleen Kaur",    email: "serbleen.newtonimmigration@gmail.com",     role: "Reviewer",       workspaceDriveLink: ROOT_DRIVE },
  { name: "Neha Brar",        email: "neha.newtonimmigration@gmail.com",         role: "Admin",          workspaceDriveLink: ROOT_DRIVE },
  { name: "Manpreet Kaur",    email: "manpreetnewtonimmigration8@gmail.com",     role: "Admin",          workspaceDriveLink: ROOT_DRIVE },
  { name: "Akanksha",         email: "akanksha.newtonimmigration@gmail.com",     role: "Admin",          workspaceDriveLink: ROOT_DRIVE },
  { name: "Team",             email: "team.newtonimmigration@gmail.com",         role: "Processing",     workspaceDriveLink: ROOT_DRIVE },
];

export const NEWTON_TEAM_MEMBERS: NewtonTeamMember[] = RAW_TEAM_MEMBERS.map((item) => ({
  ...item,
  workspaceDriveFolderId: extractDriveFolderId(item.workspaceDriveLink),
}));
