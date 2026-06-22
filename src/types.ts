import { Timestamp } from "firebase/firestore";

export type ProjectStatus = 
  | "draft" 
  | "google_connected" 
  | "sheet_connected" 
  | "script_project_created" 
  | "leads_enabled" 
  | "leads_configured" 
  | "leads_mapped" 
  | "add_lead_form_previewed" 
  | "ai_plan_ready" 
  | "sync_ready" 
  | "synced" 
  | "live" 
  | "archived";

export const projectStatusOrder: ProjectStatus[] = [
  "draft",
  "google_connected",
  "sheet_connected",
  "script_project_created",
  "leads_enabled",
  "leads_configured",
  "leads_mapped",
  "add_lead_form_previewed",
  "ai_plan_ready",
  "sync_ready",
  "synced",
  "live",
];

export type SetupStep = string;

export type SetupStage = 
  | "connect_google_sheet"
  | "choose_template"
  | "match_data"
  | "customize_design"
  | "review_build_plan"
  | "build_app"
  | "launch_app"
  | "live";

export type SetupPageType = 
  | "overview" 
  | "google" 
  | "app-script" 
  | "leads-config" 
  | "field-mapping" 
  | "form-preview" 
  | "ai-plan" 
  | "sync";

export type AuthMode = "login" | "signup";

export type OrganizationRole = "Owner" | "Admin" | "Member" | "Viewer";

export interface Project {
  id: string;
  organizationId: string;
  projectName: string;
  businessName: string;
  businessType: string;
  status: ProjectStatus;
  setupStep: string;
  setupStage: SetupStage;
  setupProgress: number;
  spreadsheetId: string | null;
  spreadsheetName: string | null;
  spreadsheetUrl: string | null;
  googleSheetTitle?: string | null;
  scriptProjectId: string | null;
  scriptProjectName: string | null;
  scriptProjectUrl: string | null;
  webAppUrl: string | null;
  adminUrl: string | null;
  ownerUserId: string;
  memberUserIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // Compatibility fields
  googleSheetId?: string | null;
  googleSheetName?: string | null;
  googleSheetUrl?: string | null;
  appsScriptProjectId?: string | null;
  appsScriptProjectName?: string | null;
  appsScriptUrl?: string | null;
}