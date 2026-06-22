import { initializeApp } from "firebase/app";
import { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getFirestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable, getFunctions } from "firebase/functions";
import "./index.css";
import type {
  Project,
  ProjectStatus,
  SetupStep,
  SetupStage,
  SetupPageType,
  AuthMode,
  OrganizationRole,
} from "./types";
import { projectStatusOrder } from "./types";
import { normalizeProject, prepareProjectUpdate } from "./lib/projectHelpers";

// Basic check for required environment variables to prevent silent initialization failures
const requiredEnvVars = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
];
const missingVars = requiredEnvVars.filter((key) => !import.meta.env[key]);
if (missingVars.length > 0 && import.meta.env.PROD) {
  console.error("Critical deployment error: Missing Firebase environment variables:", missingVars);
}

// Firebase Configuration using Vite Environment Variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "app.unscriptly.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase Services
let app: any;
let auth: any;
let db: any;
let functions: any;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app, "us-central1");
} catch (err) {
  console.error("Firebase failed to initialize. Check your environment variables.", err);
}

const defaultRequiredLeadsFields = [
  "Lead ID",
  "Customer Name",
  "Phone",
  "Service Type",
  "Email",
  "Lead Source",
  "Status",
  "Notes",
  "Created At",
  "Updated At",
];

const defaultRecommendedLeadsFields = [
  "Assigned To",
  "Next Follow-Up Date",
  "Created By",
];

const defaultLeadStatuses = [
  "New",
  "Contacted",
  "Estimate Scheduled",
  "Estimate Sent",
  "Won",
  "Lost",
];

const defaultMockLeadSheetColumns = [
  "Lead ID",
  "Customer Name",
  "Phone",
  "Email",
  "Service Type",
  "Lead Source",
  "Status",
  "Assigned To",
  "Next Follow-Up Date",
  "Created At",
  "Created By",
  "Updated At",
  "Notes",
];

const defaultLeadFieldMappings: Record<string, string> = {
  "Lead ID": "Lead ID",
  "Customer Name": "Customer Name",
  Phone: "Phone",
  Email: "Email",
  "Service Type": "Service Type",
  "Lead Source": "Lead Source",
  Status: "Status",
  "Assigned To": "Assigned To",
  "Next Follow-Up Date": "Next Follow-Up Date",
  Notes: "Notes",
  "Created At": "Created At",
  "Created By": "Created By",
  "Updated At": "Updated At",
};

/**
 * Helper to format internal setup page IDs into user-facing labels.
 * e.g., "leads-config" becomes "Leads Config"
 */
function formatStepLabel(step: string): string {
  return step
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function OrganizationSwitcher({ 
  activeOrgId, 
  userOrgs, 
  onOrgChange 
}: { 
  activeOrgId: string | null; 
  userOrgs: { id: string; name: string }[]; 
  onOrgChange: (id: string) => void; 
}) {
  return (
    <select value={activeOrgId || ""} onChange={(e) => onOrgChange(e.target.value)}>
      {userOrgs.map((org) => (
        <option key={org.id} value={org.id}>{org.name}</option>
      ))}
    </select>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [setupPage, setSetupPage] = useState<SetupPageType>("overview");
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [newOrgNameInput, setNewOrgNameInput] = useState("");
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [userOrgs, setUserOrgs] = useState<{ id: string; name: string }[]>([]);
  const [orgMembers, setOrgMembers] = useState<{ userId: string; role: string; email: string }[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const [leadsTabName, setLeadsTabName] = useState("Leads");
  const [selectedRequiredFields, setSelectedRequiredFields] = useState<string[]>(
    defaultRequiredLeadsFields
  );
  const [selectedRecommendedFields, setSelectedRecommendedFields] =
    useState<string[]>(defaultRecommendedLeadsFields);
  const [leadStatusesText, setLeadStatusesText] = useState(
    defaultLeadStatuses.join("\n")
  );
  const [sheetColumnsText, setSheetColumnsText] = useState(
    defaultMockLeadSheetColumns.join("\n")
  );
  const [leadFieldMappings, setLeadFieldMappings] = useState<Record<string, string>>(
    defaultLeadFieldMappings
  );
  const [addLeadPreviewValues, setAddLeadPreviewValues] = useState<Record<string, string>>({
    "Customer Name": "Jane Smith",
    Phone: "(903) 555-0142",
    Email: "jane@example.com",
    "Service Type": "Roof Repair",
    "Lead Source": "Website",
    Status: "New",
    "Assigned To": "Office",
    "Next Follow-Up Date": "2026-06-21",
    Notes: "Customer requested an estimate this week.",
  });
  const [aiPlanGenerated, setAiPlanGenerated] = useState(false);
  const [aiPlanApproved, setAiPlanApproved] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("Roofing");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Member");
  const [orgRenameValue, setOrgRenameValue] = useState("");

  const [message, setMessage] = useState("");
  const [existingSheetInput, setExistingSheetInput] = useState("");
  const [error, setError] = useState("");

  const userInitial = useMemo(() => {
    return user?.email?.slice(0, 1).toUpperCase() || "U";
  }, [user]);

  const nextAction = useMemo(() => {
    if (!selectedProject) return null;
    const status = selectedProject.status;
    if (status === "draft") return { label: "Connect Google", page: "google" as SetupPageType, desc: "Connect your Google account to start the integration." };
    if (status === "google_connected") return { label: "Select Sheet", page: "google" as SetupPageType, desc: "Choose a Google Sheet to power your dashboard." };
    if (status === "sheet_connected") return { label: "Apps Script", page: "app-script" as SetupPageType, desc: "Prepare the Apps Script project for automation." };
    if (status === "script_project_created") return { label: "Enable Leads", page: "overview" as SetupPageType, desc: "Enable the Leads module to manage your pipeline." };
    if (status === "leads_enabled") return { label: "Configure Leads", page: "leads-config" as SetupPageType, desc: "Define fields and statuses for your leads." };
    if (status === "leads_configured") return { label: "Map Fields", page: "field-mapping" as SetupPageType, desc: "Match lead fields to your Sheet columns." };
    if (status === "leads_mapped") return { label: "Preview Form", page: "form-preview" as SetupPageType, desc: "Review the generated Add Lead form." };
    if (status === "add_lead_form_previewed") return { label: "AI Plan", page: "ai-plan" as SetupPageType, desc: "Review the AI-generated implementation plan." };
    if (status === "ai_plan_ready") return { label: "Approve Plan", page: "ai-plan" as SetupPageType, desc: "Approve the plan to enable the build sync." };
    if (status === "sync_ready") return { label: "Sync & Launch", page: "sync" as SetupPageType, desc: "Finalize the build and launch your dashboard." };
    return { label: "Dashboard Ready", page: "overview" as SetupPageType, desc: "Your dashboard is synced and operational." };
  }, [selectedProject]);

  // Centralized Helper for Project Updates
  const updateProjectPersistence = async (projectId: string, updates: Partial<Project>) => {
    try {
      const ref = doc(db, "projects", projectId);
      const normalizedUpdates = prepareProjectUpdate(updates);
      await updateDoc(ref, { ...normalizedUpdates, updatedAt: serverTimestamp() });
      return true;
    } catch (err) {
      console.error("Persistence Error:", err);
      setError("Failed to save changes to the cloud.");
      return false;
    }
  };

  async function loadUserOrgs(uid: string) {
    const mQuery = query(
      collection(db, "organizationMembers"),
      where("userId", "==", uid)
    );
    const mSnap = await getDocs(mQuery);
    
    const orgs = (await Promise.all(
      mSnap.docs.map(async (mDoc) => {
        const mData = mDoc.data();
        const oDoc = await getDoc(doc(db, "organizations", mData.organizationId));
        return oDoc.exists() 
          ? { id: oDoc.id, name: oDoc.data().name as string } 
          : null;
      })
    )).filter((org): org is { id: string; name: string } => org !== null);

    setUserOrgs(orgs);
    return orgs;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);

      if (currentUser) {
        await setDoc(
          doc(db, "users", currentUser.uid),
          {
            uid: currentUser.uid,
            email: currentUser.email,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        // Fetch user's organizations
        const orgs = await loadUserOrgs(currentUser.uid);
        if (orgs.length > 0) {
          setActiveOrgId((prev) => prev || orgs[0].id);
        }
      } else {
        setProjects([]);
        setUserOrgs([]);
        setActiveOrgId(null);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user && activeOrgId) {
      loadProjects(activeOrgId);
      loadOrgMembers(activeOrgId);
      // Update rename input when active org changes
      const currentOrg = userOrgs.find((o) => o.id === activeOrgId);
      if (currentOrg) {
        setOrgRenameValue(currentOrg.name);
      }
    }
  }, [user, activeOrgId, userOrgs]);

  async function loadOrgMembers(orgId: string) {
    try {
      const mQuery = query(
        collection(db, "organizationMembers"),
        where("organizationId", "==", orgId)
      );
      const mSnap = await getDocs(mQuery);

      const members = await Promise.all(
        mSnap.docs.map(async (mDoc) => {
          const mData = mDoc.data();
          const uDoc = await getDoc(doc(db, "users", mData.userId));
          return {
            userId: mData.userId,
            role: mData.role,
            email: uDoc.exists() ? uDoc.data().email : "Unknown User",
          };
        })
      );

      setOrgMembers(members);
    } catch (err) {
      console.error("Failed to load members:", err);
    }
  }

  async function loadProjects(orgId: string) {
    setLoadingProjects(true);
    setError("");

    try {
      const orgProjectsQuery = query(
        collection(db, "projects"),
        where("organizationId", "==", orgId)
      );

      const snapshot = await getDocs(orgProjectsQuery);

      let loadedProjects = snapshot.docs.map((projectDoc) => normalizeProject({
        id: projectDoc.id,
        ...(projectDoc.data() as Omit<Project, "id">),
      }));

      loadedProjects.sort((a, b) => {
        // Safety check: if createdAt is a serverTimestamp FieldValue, it won't have toMillis()
        // We check if the function exists before calling it to prevent a white-screen crash.
        const getMillis = (ts: any) => {
          if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
          if (ts instanceof Date) return ts.getTime();
          return 0;
        };
        const aTime = getMillis(a.createdAt);
        const bTime = getMillis(b.createdAt);
        return bTime - aTime;
      });

      setProjects(loadedProjects);
      applyOAuthReturnState(loadedProjects);
    } catch (err) {
      console.error(err);
      setError("Could not load projects. Check Firestore permissions.");
    } finally {
      setLoadingProjects(false);
    }
  }

  async function handleAuthSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      if (mode === "signup") {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const uid = result.user.uid;

        // Section 11.4: Organization Bootstrap
        const orgRef = doc(collection(db, "organizations"));
        const organizationId = orgRef.id;
        const orgName = `${email.split("@")[0]}'s Workspace`;

        await setDoc(orgRef, {
          id: organizationId,
          name: orgName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: uid,
        });

        await setDoc(doc(db, "organizationMembers", `${organizationId}_${uid}`), {
          organizationId,
          userId: uid,
          role: "Owner",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: uid,
        });

        await setDoc(doc(db, "users", uid), {
          uid: uid,
          email: result.user.email,
          displayName: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        // Immediately update state so projects can be created/loaded
        setUserOrgs([{ id: organizationId, name: orgName }]);
        setActiveOrgId(organizationId);

        setMessage("Account created. Welcome to UnScriptly.");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        setMessage("Signed in successfully.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Authentication failed.");
    }
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !newOrgNameInput.trim()) return;

    setError("");
    setMessage("");

    try {
      const orgRef = doc(collection(db, "organizations"));
      const organizationId = orgRef.id;

      await setDoc(orgRef, {
        id: organizationId,
        name: newOrgNameInput.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user.uid,
      });

      await setDoc(doc(db, "organizationMembers", `${organizationId}_${user.uid}`), {
        organizationId,
        userId: user.uid,
        role: "Owner",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user.uid,
      });

      await loadUserOrgs(user.uid);
      setActiveOrgId(organizationId);
      setIsCreatingOrg(false);
      setNewOrgNameInput("");
      setMessage(`Workspace "${newOrgNameInput}" created.`);
    } catch (err: any) {
      console.error("Create workspace failed:", err);
      setError(err?.message || "Failed to create workspace.");
    }
  }

  async function handleRemoveMember(memberUid: string) {
    if (!activeOrgId) return;
    try {
      await deleteDoc(doc(db, "organizationMembers", `${activeOrgId}_${memberUid}`));
      setMessage("Member removed successfully.");
      await loadOrgMembers(activeOrgId);
    } catch (err: any) {
      console.error("Remove member failed:", err);
      setError(err?.message || "Failed to remove member.");
    }
  }

  async function handleLeaveOrganization() {
    if (!activeOrgId || !user) return;
    if (!window.confirm("Are you sure you want to leave this organization?")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "organizationMembers", `${activeOrgId}_${user.uid}`));
      setMessage("You have left the organization.");
      
      const updatedOrgs = await loadUserOrgs(user.uid);
      if (updatedOrgs.length > 0) {
        setActiveOrgId(updatedOrgs[0].id);
      } else {
        setActiveOrgId(null);
        setProjects([]);
      }
    } catch (err: any) {
      console.error("Leave organization failed:", err);
      setError(err?.message || "Failed to leave organization.");
    }
  }

  async function handleDeleteOrganization() {
    if (!activeOrgId || !user) return;
    
    const currentOrg = userOrgs.find(o => o.id === activeOrgId);
    const confirmName = window.prompt(
      `WARNING: This will permanently delete the organization "${currentOrg?.name}", all its projects, and remove all members. To confirm, type the organization name below:`
    );
    
    if (confirmName !== currentOrg?.name) {
      if (confirmName !== null) setError("Organization name mismatch. Deletion cancelled.");
      return;
    }

    try {
      // 1. Delete all projects in this organization
      const projectsQuery = query(collection(db, "projects"), where("organizationId", "==", activeOrgId));
      const projectsSnap = await getDocs(projectsQuery);
      for (const pDoc of projectsSnap.docs) {
        await deleteDoc(doc(db, "projects", pDoc.id));
      }

      // 2. Delete all membership records
      const membersQuery = query(collection(db, "organizationMembers"), where("organizationId", "==", activeOrgId));
      const membersSnap = await getDocs(membersQuery);
      for (const mDoc of membersSnap.docs) {
        await deleteDoc(doc(db, "organizationMembers", mDoc.id));
      }

      // 3. Delete the organization document
      await deleteDoc(doc(db, "organizations", activeOrgId));

      setMessage("Organization and all associated data deleted.");
      
      const updatedOrgs = await loadUserOrgs(user.uid);
      setActiveOrgId(updatedOrgs.length > 0 ? updatedOrgs[0].id : null);
      if (updatedOrgs.length === 0) setProjects([]);
    } catch (err: any) {
      console.error("Delete organization failed:", err);
      setError(err?.message || "Failed to delete organization.");
    }
  }

  async function handleUpdateMemberRole(memberUid: string, newRole: OrganizationRole) {
    if (!activeOrgId) return;
    try {
      await updateDoc(doc(db, "organizationMembers", `${activeOrgId}_${memberUid}`), {
        role: newRole,
        updatedAt: serverTimestamp(),
      });
      setMessage("Member role updated.");
      await loadOrgMembers(activeOrgId);
    } catch (err: any) {
      console.error("Update role failed:", err);
      setError(err?.message || "Failed to update role.");
    }
  }

  async function handleRenameOrganization() {
    if (!activeOrgId || !user) return;
    const cleanName = orgRenameValue.trim();
    if (!cleanName) {
      setError("Please enter a workspace name.");
      return;
    }
    try {
      await updateDoc(doc(db, "organizations", activeOrgId), {
        name: cleanName,
        updatedAt: serverTimestamp(),
      });
      setMessage("Workspace renamed successfully.");
      await loadUserOrgs(user.uid);
    } catch (err: any) {
      console.error("Rename failed:", err);
      setError(err?.message || "Failed to rename workspace.");
    }
  }

  async function handleInviteUser() {
    if (!activeOrgId || !user) return;
    
    setError("");
    setMessage("");

    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Please enter an email to invite.");
      return;
    }

    try {
      const userQuery = query(collection(db, "users"), where("email", "==", cleanEmail));
      const userSnap = await getDocs(userQuery);
      
      if (userSnap.empty) {
        setError("User not found. They must sign up for UnScriptly first.");
        return;
      }

      const invitedUid = userSnap.docs[0].id;

      // Check if user is already a member
      const memberCheck = await getDoc(doc(db, "organizationMembers", `${activeOrgId}_${invitedUid}`));
      if (memberCheck.exists()) {
        setError("This user is already a member of the organization.");
        return;
      }

      await setDoc(doc(db, "organizationMembers", `${activeOrgId}_${invitedUid}`), {
        organizationId: activeOrgId,
        userId: invitedUid,
        role: inviteRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user.uid,
      });

      setMessage(`Successfully invited ${cleanEmail} as ${inviteRole}.`);
      setInviteEmail("");
      await loadOrgMembers(activeOrgId);
    } catch (err: any) {
      console.error("Invite failed:", err);
      setError(err?.message || "Failed to invite user.");
    }
  }

  function applyOAuthReturnState(loadedProjects: Project[]) {
    const params = new URLSearchParams(window.location.search);
    const returnedProjectId = params.get("projectId");
    const returnedSetupPage = params.get("setupPage");
    const googleConnected = params.get("googleConnected");

    if (!returnedProjectId) {
      return;
    }

    const returnedProject = loadedProjects.find(
      (project) => project.id === returnedProjectId
    );

    if (!returnedProject) {
      return;
    }

    setSelectedProject(returnedProject);

    if (
      returnedSetupPage === "google" ||
      returnedSetupPage === "overview" ||
      returnedSetupPage === "sync"
    ) {
      setSetupPage(returnedSetupPage);
    } else {
      setSetupPage("google");
    }

    if (googleConnected === "1") {
      setMessage("Google connected successfully.");
    }

    window.history.replaceState({}, document.title, window.location.pathname);
  }

  async function handleCreateProject(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

  if (!user) {
      setError("You must be signed in to create a project.");
      return;
    }

    if (!activeOrgId) {
      setError("No active organization found.");
      return;
    }

    setError("");
    setMessage("");

    const cleanProjectName = projectName.trim();
    const cleanBusinessName = businessName.trim();

    if (!cleanProjectName || !cleanBusinessName) {
      setError("Project Name and Business Name are required.");
      return;
    }

    try {
      const newProject = {
        ownerUserId: user.uid,
        ownerEmail: user.email || "",
        createdByUid: user.uid,
        memberUserIds: [user.uid],
        organizationId: activeOrgId,
        projectName: cleanProjectName,
        businessName: cleanBusinessName,
        businessType,
        status: "draft" as ProjectStatus,
        setupStep: "project_created" as SetupStep,
        setupStage: "connect_google_sheet" as SetupStage,
        setupProgress: 10,
        googleSheetId: null,
        googleSheetUrl: null,
        googleSheetName: null,
        appsScriptProjectId: null,
        appsScriptProjectName: null,
        appsScriptUrl: null,
        webAppUrl: null,
        adminUrl: null,
        techUrl: null,
        sdkVersion: "0.1.0",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const createdRef = await addDoc(collection(db, "projects"), newProject);

      const createdProject = {
        id: createdRef.id,
        ...newProject,
      } as unknown as Project;

      setProjects((currentProjects) => [createdProject, ...currentProjects]);

      setProjectName("");
      setBusinessName("");
      setBusinessType("Roofing");
      setMessage("Project created successfully.");

      await loadProjects(activeOrgId);
    } catch (err: any) {
      console.error("Create project failed:", err);
      setError(err?.message || "Could not create project. Check Firestore rules.");
    }
  }

  async function handleRealConnectGoogle() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    setError("");
    setMessage("Starting Google connection...");

    try {
      const startGoogleOAuth = httpsCallable(functions, "startGoogleOAuth");
      const result: any = await startGoogleOAuth({
        projectId: selectedProject.id,
      });

      const url = result.data?.url;

      if (!url) {
        throw new Error("Google OAuth URL was not returned.");
      }

      window.location.href = url;
    } catch (err: any) {
      console.error("Start Google OAuth failed:", err);
      setError(err?.message || "Could not start Google connection.");
    }
  }

  async function handleMockConnectGoogle() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    setError("");
    setMessage("");

    try {
      const updatedProject: Project = {
        ...selectedProject,
        status: "google_connected",
        setupStep: "google_connected",
      };

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "google_connected",
        setupStep: "google_connected",
        updatedAt: serverTimestamp(),
      });

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Google connection step completed for this project.");
    } catch (err: any) {
      console.error("Mock Google connection failed:", err);
      setError(err?.message || "Could not update project status.");
    }
  }

  function getSheetUrl(sheetId?: string) {
    return sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : "";
  }

  function getDefaultSheetName(project?: Project | null) {
    return `${project?.projectName || "Project"} - UnScriptly Operations`;
  }

  function getDisplaySheetName(project?: Project | null) {
    return (
      project?.googleSheetName ||
      project?.googleSheetTitle ||
      getDefaultSheetName(project)
    );
  }

  function extractGoogleSheetId(value: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      return "";
    }

    const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

    if (urlMatch?.[1]) {
      return urlMatch[1];
    }

    if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) {
      return trimmed;
    }

    return "";
  }

  async function handleRealChooseGoogleSheet() {
    if (!selectedProject) {
      setError("Select a project first.");
      return;
    }

    setError("");
    setMessage("Creating a new Google Sheet for this project...");

    try {
      const runRealSync = httpsCallable(functions, "runRealSync");
      const result = await runRealSync({
        projectId: selectedProject.id,
      });

      const data = (result.data || {}) as {
        sheetId?: string;
        sheetUrl?: string;
        sheetName?: string;
        title?: string;
        appsScriptProjectId?: string;
      };

      const sheetId = data.sheetId || "";
      const sheetUrl = data.sheetUrl || getSheetUrl(sheetId);
      const sheetName = data.sheetName || data.title || getDefaultSheetName(selectedProject);
      const scriptId = data.appsScriptProjectId || "";

      const updates: Partial<Project> = {
        spreadsheetId: sheetId,
        spreadsheetUrl: sheetUrl,
        spreadsheetName: sheetName,
        scriptProjectId: scriptId || selectedProject.scriptProjectId,
        status: "sheet_connected",
        setupStep: "sheet_connected",
        setupStage: "choose_template" as SetupStage,
        setupProgress: 30,
      };

      await updateProjectPersistence(selectedProject.id, updates);

      const updatedProject: Project = normalizeProject({
        ...selectedProject,
        ...updates,
      });

      setSelectedProject(updatedProject);
      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("New Google Sheet created. Review it, then continue to Apps Script.");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not create the Google Sheet. Try reconnecting Google."
      );
    }
  }

  async function handleConnectExistingSheet() {
    if (!selectedProject) {
      setError("Select a project first.");
      return;
    }

    const sheetId = extractGoogleSheetId(existingSheetInput);

    if (!sheetId) {
      setError("Paste a valid Google Sheet URL or Sheet ID.");
      return;
    }

    const sheetUrl = getSheetUrl(sheetId);
    const sheetName =
      selectedProject.googleSheetName ||
      getDefaultSheetName(selectedProject);

    setError("");
    setMessage("Connecting existing Google Sheet...");

    try {
      const updates: Partial<Project> = {
        spreadsheetId: sheetId,
        spreadsheetUrl: sheetUrl,
        spreadsheetName: sheetName,
        status: "sheet_connected",
        setupStep: "sheet_connected",
        setupStage: "choose_template" as SetupStage,
        setupProgress: 30,
      };

      await updateProjectPersistence(selectedProject.id, updates);

      const updatedProject: Project = normalizeProject({
        ...selectedProject,
        ...updates,
      });

      setSelectedProject(updatedProject);
      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Existing Google Sheet connected. Review it, then continue to Apps Script.");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect the existing Google Sheet."
      );
    }
  }

  async function handleContinueToAppsScript() {
    if (!selectedProject?.spreadsheetId) {
      setError("Create or connect a Google Sheet before continuing.");
      return;
    }

    setError("");
    setMessage("");

    const updates: Partial<Project> = {
      status: "sheet_connected",
      setupStep: "sheet_connected",
      setupStage: "choose_template" as SetupStage,
      setupProgress: 30,
    };

    await updateProjectPersistence(selectedProject.id, updates);

    const updatedProject: Project = normalizeProject({
      ...selectedProject,
      ...updates,
    });

    setSelectedProject(updatedProject);
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === selectedProject.id ? updatedProject : project
      )
    );

    setSetupPage("app-script");
  }

  async function handleMockChooseGoogleSheet() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    if (selectedProject.status !== "google_connected" && !selectedProject.googleSheetId) {
      setError("Connect Google before choosing a Google Sheet.");
      return;
    }

    setError("");
    setMessage("");

    try {
      const updatedProject: Project = {
        ...selectedProject,
        status: "sheet_connected",
        setupStep: "sheet_connected",
      };

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "sheet_connected",
        setupStep: "sheet_connected",
        spreadsheetName: `${selectedProject.businessName} - UnScriptly Operations`,
        spreadsheetUrl: "Mock Google Sheet URL",
        updatedAt: serverTimestamp(),
      });

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Google Sheet step completed for this project.");
    } catch (err: any) {
      console.error("Mock Google Sheet setup failed:", err);
      setError(err?.message || "Could not update project Sheet status.");
    }
  }

  function isMockGoogleId(value?: string | null) {
    return Boolean(
      value &&
        (String(value).includes("mock-") ||
          value === "mock-google-sheet-id" ||
          value === "mock-apps-script-project-id")
    );
  }

  function getAppsScriptUrl(projectId?: string) {
    return projectId ? `https://script.google.com/home/projects/${projectId}/edit` : "";
  }

  function getDefaultAppsScriptName(project?: Project | null) {
    return `UnScriptly - ${project?.projectName || "Project"}`;
  }

  async function handleMockCreateAppsScriptProject() {
    if (!selectedProject) {
      setError("Select a project first.");
      return;
    }

    if (!selectedProject.spreadsheetId) {
      setError("Create or connect a Google Sheet before creating the Apps Script project.");
      return;
    }

    setError("");
    setMessage("Creating Apps Script project for this connected Google Sheet...");

    try {
      let scriptId = isMockGoogleId(selectedProject.scriptProjectId) ? "" : selectedProject.scriptProjectId || "";
      let scriptUrl = selectedProject.scriptProjectUrl || getAppsScriptUrl(scriptId);
      const scriptName = selectedProject.scriptProjectName || getDefaultAppsScriptName(selectedProject);

      if (!scriptId) {
        if (isMockGoogleId(selectedProject.scriptProjectId)) {
          await updateProjectPersistence(selectedProject.id, {
            scriptProjectId: "",
            status: "sheet_connected",
            setupStep: "sheet_connected",
          });
        }

        const runRealSync = httpsCallable(functions, "runRealSync");
        const result = await runRealSync({
          projectId: selectedProject.id,
        });

        const data = (result.data || {}) as {
          appsScriptProjectId?: string;
          scriptId?: string;
          appsScriptUrl?: string;
          scriptUrl?: string;
        };

        scriptId =
          data.appsScriptProjectId ||
          data.scriptId ||
          selectedProject.scriptProjectId ||
          "";

        scriptUrl =
          data.appsScriptUrl ||
          data.scriptUrl ||
          getAppsScriptUrl(scriptId);
      }

      const updates: Partial<Project> = {
        scriptProjectId: scriptId,
        scriptProjectName: scriptName,
        scriptProjectUrl: scriptUrl,
        status: "script_project_created",
        setupStep: "script_project_created",
        setupStage: "choose_template" as SetupStage,
        setupProgress: 40,
      };

      await updateProjectPersistence(selectedProject.id, updates);

      const updatedProject: Project = normalizeProject({
        ...selectedProject,
        ...updates,
      });

      setSelectedProject(updatedProject);
      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Apps Script project created. Continue to Leads Config.");
      setSetupPage("leads-config");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not create the Apps Script project."
      );
    }
  }

  async function handleMockEnableLeadsModule() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    if (!selectedProject.appsScriptProjectId) {
      setError("Create the Apps Script project before enabling Leads.");
      return;
    }

    setError("");
    setMessage("");

    try {
      const updatedProject: Project = {
        ...selectedProject,
        status: "leads_enabled",
        setupStep: "leads_enabled",
        setupStage: "choose_template" as SetupStage,
      };

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "leads_enabled",
        setupStep: "leads_enabled",
        setupStage: "choose_template" as SetupStage,
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "featureConfigs", `${selectedProject.id}_leads`), {
        projectId: selectedProject.id,
        moduleKey: "leads",
        enabled: true,
        tabName: "Leads",
        requiredFields: defaultRequiredLeadsFields,
        recommendedFields: defaultRecommendedLeadsFields,
        statuses: ["New", "Contacted", "Estimate Scheduled", "Won", "Lost"],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Leads module enabled. Configure Leads next.");
      setSetupPage("leads-config");
    } catch (err: any) {
      console.error("Enable Leads failed:", err);
      setError(err?.message || "Could not enable Leads module.");
    }
  }

  function toggleRequiredLeadField(fieldName: string) {
    setSelectedRequiredFields((currentFields) =>
      currentFields.includes(fieldName)
        ? currentFields.filter((field) => field !== fieldName)
        : [...currentFields, fieldName]
    );
  }

  function toggleRecommendedLeadField(fieldName: string) {
    setSelectedRecommendedFields((currentFields) =>
      currentFields.includes(fieldName)
        ? currentFields.filter((field) => field !== fieldName)
        : [...currentFields, fieldName]
    );
  }

  async function handleSaveLeadsConfiguration() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    if (!selectedProject.appsScriptProjectId) {
      setError("Create the Apps Script project before configuring Leads.");
      return;
    }

    const cleanTabName = leadsTabName.trim() || "Leads";
    const statuses = leadStatusesText
      .split("\n")
      .map((status) => status.trim())
      .filter(Boolean);

    if (selectedRequiredFields.length === 0) {
      setError("Select at least one required Leads field.");
      return;
    }

    if (statuses.length === 0) {
      setError("Add at least one Leads status.");
      return;
    }

    setError("");
    setMessage("");

    try {
      await setDoc(
        doc(db, "featureConfigs", `${selectedProject.id}_leads`),
        {
          projectId: selectedProject.id,
          moduleKey: "leads",
          enabled: true,
          tabName: cleanTabName,
          requiredFields: selectedRequiredFields,
          recommendedFields: selectedRecommendedFields,
          statuses,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "leads_configured",
        setupStep: "leads_configured",
        setupStage: "match_data" as SetupStage,
        setupProgress: 50,
        updatedAt: serverTimestamp(),
      });

      const updatedProject: Project = {
        ...selectedProject,
        status: "leads_configured",
        setupStep: "leads_configured",
        setupStage: "match_data" as SetupStage,
      };

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Leads configuration saved. Continue to Field Mapping.");
      setSetupPage("field-mapping");
    } catch (err: any) {
      console.error("Save Leads configuration failed:", err);
      setError(err?.message || "Could not save Leads configuration.");
    }
  }

  function updateLeadFieldMapping(fieldName: string, columnName: string) {
    setLeadFieldMappings((currentMappings) => ({
      ...currentMappings,
      [fieldName]: columnName,
    }));
  }

  async function handleSaveLeadFieldMappings() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    if (projectStatusOrder.indexOf(selectedProject.status) < projectStatusOrder.indexOf("leads_configured")) {
      setError("Configure the Leads module before saving field mappings.");
      return;
    }

    const sheetColumns = sheetColumnsText
      .split("\n")
      .map((column) => column.trim())
      .filter(Boolean);

    const activeFields = Array.from(
      new Set([...selectedRequiredFields, ...selectedRecommendedFields])
    );

    if (sheetColumns.length === 0) {
      setError("Add at least one Google Sheet column.");
      return;
    }

    const missingRequiredMappings = selectedRequiredFields.filter((fieldName) => {
      const mappedColumn = leadFieldMappings[fieldName];
      return !mappedColumn;
    });

    if (missingRequiredMappings.length > 0) {
      setError(
        `Map all required fields before saving. Missing: ${missingRequiredMappings.join(", ")}`
      );
      return;
    }

    const missingColumns = activeFields.filter((fieldName) => {
      const mappedColumn = leadFieldMappings[fieldName];
      return mappedColumn === "__ADD_NEW_COLUMN__";
    });

    setError("");
    setMessage("");

    try {
      await setDoc(
        doc(db, "mappings", `${selectedProject.id}_leads`),
        {
          projectId: selectedProject.id,
          moduleKey: "leads",
          tabName: leadsTabName.trim() || "Leads",
          sheetColumns,
          activeFields,
          requiredFields: selectedRequiredFields,
          recommendedFields: selectedRecommendedFields,
          fieldMappings: leadFieldMappings,
          missingColumns,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "leads_mapped",
        setupStep: "leads_mapped",
        setupStage: "customize_design" as SetupStage,
        setupProgress: 60,
        updatedAt: serverTimestamp(),
      });

      const updatedProject = {
        ...selectedProject,
        status: "leads_mapped",
        setupStep: "leads_mapped",
        setupStage: "customize_design" as SetupStage,
      } as Project;

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Leads field mappings saved.");
      setSetupPage("form-preview");
    } catch (err: any) {
      console.error("Save Leads field mappings failed:", err);
      setError(err?.message || "Could not save Leads field mappings.");
    }
  }

  function updateAddLeadPreviewValue(fieldName: string, value: string) {
    setAddLeadPreviewValues((currentValues) => ({
      ...currentValues,
      [fieldName]: value,
    }));
  }

  async function handleSaveAddLeadFormPreview() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    if (
      selectedProject.setupStep !== "leads_mapped" &&
      selectedProject.setupStep !== "add_lead_form_previewed" &&
      selectedProject.status !== "leads_configured"
    ) {
      setError("Save Leads field mappings before previewing the Add Lead form.");
      return;
    }

    const statuses = leadStatusesText
      .split("\n")
      .map((status) => status.trim())
      .filter(Boolean);

    const formFields = Array.from(
      new Set([...selectedRequiredFields, ...selectedRecommendedFields])
    ).filter(
      (fieldName) =>
        !["Lead ID", "Created At", "Created By", "Updated At"].includes(fieldName)
    );

    setError("");
    setMessage("");

    try {
      await setDoc(
        doc(db, "formConfigs", `${selectedProject.id}_leads_add`),
        {
          projectId: selectedProject.id,
          moduleKey: "leads",
          formKey: "add_lead",
          formName: "Add Lead",
          formType: "create",
          targetTabName: leadsTabName.trim() || "Leads",
          fields: formFields.map((fieldName) => ({
            fieldName,
            mappedColumn: leadFieldMappings[fieldName] || "",
            required: selectedRequiredFields.includes(fieldName),
            inputType:
              fieldName === "Status"
                ? "select"
                : fieldName === "Notes"
                  ? "textarea"
                  : fieldName.toLowerCase().includes("date")
                    ? "date"
                    : "text",
            options: fieldName === "Status" ? statuses : [],
          })),
          previewValues: addLeadPreviewValues,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "add_lead_form_previewed",
        setupStep: "add_lead_form_previewed",
        setupStage: "customize_design" as SetupStage,
        setupProgress: 70,
        updatedAt: serverTimestamp(),
      });

      const updatedProject = {
        ...selectedProject,
        status: "add_lead_form_previewed",
        setupStep: "add_lead_form_previewed",
        setupStage: "customize_design" as SetupStage,
      } as Project;

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Add Lead form preview saved.");
    } catch (err: any) {
      console.error("Save Add Lead form preview failed:", err);
      setError(err?.message || "Could not save Add Lead form preview.");
    }
  }

  function getAiImplementationPlanPreview() {
    const statuses = leadStatusesText
      .split("\n")
      .map((status) => status.trim())
      .filter(Boolean);

    const activeFields = Array.from(
      new Set([...selectedRequiredFields, ...selectedRecommendedFields])
    );

    const formFields = activeFields.filter(
      (fieldName) =>
        !["Lead ID", "Created At", "Created By", "Updated At"].includes(fieldName)
    );

    return {
      summary:
        "Generate a private Apps Script dashboard connected to the selected Google Sheet with Leads module support, an Add Lead form, field mappings, status handling, and basic admin runtime actions.",
      sheetChanges: [
        `Confirm or create tab: ${leadsTabName.trim() || "Leads"}`,
        `Confirm required columns: ${selectedRequiredFields.join(", ")}`,
        `Confirm recommended columns: ${selectedRecommendedFields.join(", ")}`,
        `Use statuses: ${statuses.join(", ")}`,
        "Preserve existing rows, formulas, and manually entered data",
      ],
      appsScriptFiles: [
        "appsscript.json",
        "Code.gs",
        "Routes.gs",
        "ClientConfig.gs",
        "RuntimeAuth.gs",
        "RuntimeData.gs",
        "RuntimeActions.gs",
        "RuntimeForms.gs",
        "Admin.html",
        "Login.html",
        "Styles.html",
        "Scripts.html",
        "Components.html",
        "Forms.html",
      ],
      forms: [
        {
          name: "Add Lead",
          type: "create",
          targetTab: leadsTabName.trim() || "Leads",
          fields: formFields,
        },
      ],
      runtimeActions: [
        "Load Leads records from Google Sheets",
        "Create a new Lead record",
        "Generate Lead ID if missing",
        "Validate required Lead fields before save",
        "Write audit log entry for created Leads",
        "Render admin dashboard Leads table",
      ],
      safetyChecks: [
        "Do not delete existing Sheet tabs",
        "Do not delete existing columns",
        "Do not rename existing columns without approval",
        "Do not overwrite existing operational records",
        "Require user approval before Sync",
        "Generate a full Apps Script file set before updateContent",
      ],
      warnings: [
        "Google OAuth, real Sheet detection, and real Apps Script generation are not connected yet.",
        "This plan is currently a preview generated from local project configuration.",
      ],
      blockers: [],
    };
  }

  async function handleGenerateAiImplementationPlan() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    if (
      selectedProject.setupStep !== "add_lead_form_previewed" &&
      selectedProject.setupStep !== "ai_plan_ready" &&
      selectedProject.setupStep !== "sync_ready"
    ) {
      setError("Save the Add Lead form preview before generating the AI plan.");
      return;
    }

    setError("");
    setMessage("");

    const plan = getAiImplementationPlanPreview();

    try {
      await setDoc(
        doc(db, "aiImplementationPlans", `${selectedProject.id}_latest`),
        {
          projectId: selectedProject.id,
          planType: "mock_ai_implementation_plan",
          approved: false,
          status: "ready_for_review",
          summary: plan.summary,
          sheetChanges: plan.sheetChanges,
          appsScriptFiles: plan.appsScriptFiles,
          forms: plan.forms,
          runtimeActions: plan.runtimeActions,
          safetyChecks: plan.safetyChecks,
          warnings: plan.warnings,
          blockers: plan.blockers,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "ai_plan_ready",
        setupStep: "ai_plan_ready",
        setupStage: "review_build_plan" as SetupStage,
        setupProgress: 80,
        updatedAt: serverTimestamp(),
      });

      const updatedProject = {
        ...selectedProject,
        status: "ai_plan_ready",
        setupStep: "ai_plan_ready",
        setupStage: "review_build_plan" as SetupStage,
      } as Project;

      setSelectedProject(updatedProject);
      setAiPlanGenerated(true);
      setAiPlanApproved(false);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("AI Implementation Plan generated for review.");
    } catch (err: any) {
      console.error("Generate AI plan failed:", err);
      setError(err?.message || "Could not generate AI Implementation Plan.");
    }
  }

  async function handleApproveAiImplementationPlan() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    if (!aiPlanGenerated && selectedProject.setupStep !== "ai_plan_ready") {
      setError("Generate the AI Implementation Plan before approving it.");
      return;
    }

    setError("");
    setMessage("");

    try {
      await setDoc(
        doc(db, "aiImplementationPlans", `${selectedProject.id}_latest`),
        {
          projectId: selectedProject.id,
          approved: true,
          status: "approved_for_sync",
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updateDoc(doc(db, "projects", selectedProject.id), {
        status: "sync_ready",
        setupStep: "sync_ready",
        setupStage: "build_app" as SetupStage,
        setupProgress: 90,
        updatedAt: serverTimestamp(),
      });

      const updatedProject = {
        ...selectedProject,
        status: "sync_ready",
        setupStep: "sync_ready",
        setupStage: "build_app" as SetupStage,
      } as Project;

      setSelectedProject(updatedProject);
      setAiPlanApproved(true);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("AI Implementation Plan approved. Project is ready for Sync.");
    } catch (err: any) {
      console.error("Approve AI plan failed:", err);
      setError(err?.message || "Could not approve AI Implementation Plan.");
    }
  }

  function getSyncCenterPreview() {
    const isPlanApproved =
      selectedProject?.setupStep === "sync_ready" ||
      selectedProject?.setupStep === "pre_sync_reviewed" ||
      selectedProject?.setupStep === "synced_mock" ||
      selectedProject?.status === "synced";

    return {
      isPlanApproved,
      readinessItems: [
        {
          label: "Google connected",
          ready:
            selectedProject?.status === "google_connected" ||
            selectedProject?.status === "sheet_connected" ||
            selectedProject?.status === "script_project_created" ||
            selectedProject?.status === "leads_configured",
        },
        {
          label: "Google Sheet selected",
          ready:
            selectedProject?.status === "sheet_connected" ||
            selectedProject?.status === "script_project_created" ||
            selectedProject?.status === "leads_configured",
        },
        {
          label: "Apps Script project created",
          ready:
            selectedProject?.status === "script_project_created" ||
            selectedProject?.status === "leads_configured",
        },
        {
          label: "Leads configured",
          ready: selectedProject?.status === "leads_configured",
        },
        {
          label: "AI plan approved",
          ready: isPlanApproved,
        },
      ],
      sheetChanges: [
        `Confirm tab: ${leadsTabName.trim() || "Leads"}`,
        "Confirm required Leads columns exist",
        "Add missing approved columns to the right side only",
        "Preserve all existing rows and formulas",
        "Write sync log entry after successful sync",
      ],
      scriptChanges: [
        "Generate full Apps Script file set",
        "Generate admin dashboard shell",
        "Generate Leads table runtime",
        "Generate Add Lead form runtime",
        "Generate runtime validation helpers",
        "Generate audit log helpers",
      ],
      safetyRules: [
        "No Sheet data will be deleted",
        "No columns will be renamed automatically",
        "No tabs will be removed",
        "No Apps Script deployment will be updated without a separate Deploy step",
        "Full file generation is required before Apps Script updateContent",
        "User approval is required before real Sync",
      ],
      blockedReasons: isPlanApproved
        ? []
        : ["AI Implementation Plan must be approved before Sync can run."],
    };
  }

  async function handleSaveSyncCenterPreview() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    const preview = getSyncCenterPreview();

    if (!preview.isPlanApproved) {
      setError("Approve the AI Implementation Plan before completing pre-sync review.");
      return;
    }

    setError("");
    setMessage("");

    try {
      await setDoc(
        doc(db, "syncRuns", `${selectedProject.id}_preview`),
        {
          projectId: selectedProject.id,
          runType: "pre_sync_preview",
          status: "reviewed",
          syncAllowed: true,
          readinessItems: preview.readinessItems,
          sheetChanges: preview.sheetChanges,
          scriptChanges: preview.scriptChanges,
          safetyRules: preview.safetyRules,
          blockedReasons: preview.blockedReasons,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updateDoc(doc(db, "projects", selectedProject.id), {
        setupStep: "pre_sync_reviewed",
        setupStage: "build_app" as SetupStage,
        updatedAt: serverTimestamp(),
      });

      const updatedProject = {
        ...selectedProject,
        setupStep: "pre_sync_reviewed",
        setupStage: "build_app" as SetupStage,
      } as Project;

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage("Pre-sync review saved. This project is ready for the real Sync build.");
    } catch (err: any) {
      console.error("Save Sync Center preview failed:", err);
      setError(err?.message || "Could not save Sync Center preview.");
    }
  }

  function generateAppsScriptFileSet() {
    const tabName = leadsTabName.trim() || "Leads";

    return [
      {
        name: "appsscript.json",
        type: "json",
        source: JSON.stringify(
          {
            timeZone: "America/Chicago",
            dependencies: {},
            exceptionLogging: "STACKDRIVER",
            runtimeVersion: "V8",
            webapp: {
              executeAs: "USER_DEPLOYING",
              access: "ANYONE_ANONYMOUS",
            },
          },
          null,
          2
        ),
      },
      {
        name: "Code.gs",
        type: "server_js",
        source: `function doGet(e) {
  return HtmlService.createTemplateFromFile('Admin')
    .evaluate()
    .setTitle('UnScriptly Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}`,
      },
      {
        name: "Routes.gs",
        type: "server_js",
        source: `var UNS_ROUTES = {
  admin: 'Admin',
  login: 'Login'
};`,
      },
      {
        name: "ClientConfig.gs",
        type: "server_js",
        source: `var UNS_CONFIG = {
  appName: 'UnScriptly Dashboard',
  leadsTabName: '${tabName}',
  moduleKeys: ['leads'],
  generatedAt: new Date().toISOString()
};`,
      },
      {
        name: "RuntimeAuth.gs",
        type: "server_js",
        source: `function getCurrentUser_() {
  return {
    email: Session.getActiveUser().getEmail(),
    role: 'admin'
  };
}`,
      },
      {
        name: "RuntimeData.gs",
        type: "server_js",
        source: `function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getTab_(tabName) {
  var sheet = getSheet_().getSheetByName(tabName);
  if (!sheet) {
    throw new Error('Missing tab: ' + tabName);
  }
  return sheet;
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}`,
      },
      {
        name: "RuntimeActions.gs",
        type: "server_js",
        source: `function createLead(payload) {
  var sheet = getTab_(UNS_CONFIG.leadsTabName);
  var headers = getHeaders_(sheet);

  var row = headers.map(function(header) {
    if (header === 'Lead ID') return 'LEAD-' + new Date().getTime();
    if (header === 'Created At') return new Date();
    if (header === 'Updated At') return new Date();
    return payload[header] || '';
  });

  sheet.appendRow(row);
  return { ok: true };
}`,
      },
      {
        name: "RuntimeForms.gs",
        type: "server_js",
        source: `function getAddLeadFormConfig() {
  return {
    formKey: 'add_lead',
    title: 'Add Lead',
    targetTabName: UNS_CONFIG.leadsTabName
  };
}`,
      },
      {
        name: "Admin.html",
        type: "html",
        source: `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <?!= include('Styles'); ?>
  </head>
  <body>
    <main class="app-shell">
      <section class="hero">
        <p class="eyebrow">UnScriptly</p>
        <h1>Leads Dashboard</h1>
        <p>Generated Apps Script dashboard preview.</p>
      </section>

      <?!= include('Forms'); ?>
    </main>

    <?!= include('Scripts'); ?>
  </body>
</html>`,
      },
      {
        name: "Login.html",
        type: "html",
        source: `<section class="login-card">
  <h1>Login</h1>
  <p>Runtime auth placeholder.</p>
</section>`,
      },
      {
        name: "Styles.html",
        type: "html",
        source: `<style>
  body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: #f8fafc;
    color: #111827;
  }

  .app-shell {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px;
  }

  .hero,
  .form-card {
    border: 1px solid #e5e7eb;
    border-radius: 20px;
    padding: 24px;
    background: #ffffff;
    margin-bottom: 20px;
  }

  .eyebrow {
    color: #2563eb;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 12px;
    font-weight: 800;
  }

  label {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
    font-weight: 700;
  }

  input,
  select,
  textarea {
    border: 1px solid #d1d5db;
    border-radius: 10px;
    padding: 10px;
  }

  button {
    border: 0;
    border-radius: 10px;
    padding: 11px 14px;
    color: white;
    background: #111827;
    font-weight: 800;
  }
</style>`,
      },
      {
        name: "Scripts.html",
        type: "html",
        source: `<script>
  function submitLeadPreview() {
    alert('This generated dashboard is ready for runtime wiring.');
  }
</script>`,
      },
      {
        name: "Components.html",
        type: "html",
        source: `<template id="empty-state">
  <p>No records yet.</p>
</template>`,
      },
      {
        name: "Forms.html",
        type: "html",
        source: `<section class="form-card">
  <h2>Add Lead</h2>
  <form onsubmit="submitLeadPreview(); return false;">
    <label>
      Customer Name
      <input name="Customer Name" required>
    </label>

    <label>
      Phone
      <input name="Phone" required>
    </label>

    <label>
      Service Type
      <input name="Service Type" required>
    </label>

    <label>
      Status
      <select name="Status" required>
        ${leadStatusesText
          .split("\n")
          .map((status) => status.trim())
          .filter(Boolean)
          .map((status) => `<option>${status}</option>`)
          .join("\n        ")}
      </select>
    </label>

    <label>
      Notes
      <textarea name="Notes"></textarea>
    </label>

    <button type="submit">Submit Lead</button>
  </form>
</section>`,
      },
    ];
  }

  async function handleRunSyncMvp() {
    if (!selectedProject) {
      setError("No project selected.");
      return;
    }

    setError("");
    setMessage("Running real Google Sync...");

    try {
      const runRealSync = httpsCallable(functions, "runRealSync");
      const result: any = await runRealSync({
        projectId: selectedProject.id,
      });

      const data = result.data;

      const updatedProject = {
        ...selectedProject,
        status: "synced",
        setupStage: "launch_app" as SetupStage,
        setupProgress: 100,
        setupStep: "synced_real",
      } as Project;

      setSelectedProject(updatedProject);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === selectedProject.id ? updatedProject : project
        )
      );

      setMessage(
        `Real Sync completed. Sheet and Apps Script were updated. Sync Run: ${data.syncRunId}`
      );
    } catch (err: any) {
      console.error("Real Sync failed:", err);
      setError(err?.message || "Could not run real Google Sync.");
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setMessage("");
    setError("");
  }

  if (!authReady) {
    return (
      <main className="page-center">
        <div className="loading-card">Loading UnScriptly...</div>
      </main>
    );
  }

  // Legacy mock builders are intentionally retained for fallback/dev mode.
  // Mark them as referenced so TypeScript allows the real Google sync build.
  void handleMockConnectGoogle;
  void handleMockChooseGoogleSheet;
  void generateAppsScriptFileSet;

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-hero">
          <div className="brand-mark">U</div>
          {error && error.includes("Configuration") && (
            <div className="error-box" style={{ marginTop: 32, marginBottom: -12, maxWidth: 600 }}>
              <strong>System Configuration Error</strong>
              <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 400, lineHeight: 1.4 }}>
                {error}
              </p>
            </div>
          )}
          <p className="eyebrow">UnScriptly</p>
          <h1>Turn your Google Sheet into a private dashboard.</h1>
          <p className="hero-copy">
            Connect your Sheet, choose your features, preview your setup, and
            prepare your Apps Script dashboard without touching code.
          </p>

          <div className="hero-checklist">
            <span>Google Sheets-powered</span>
            <span>Apps Script-ready</span>
            <span>Built for home service teams</span>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-tabs">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={mode === "signup" ? "active" : ""}
              onClick={() => setMode("signup")}
              type="button"
            >
              Sign up
            </button>
          </div>

          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="muted">
            {mode === "login"
              ? "Sign in to manage your UnScriptly projects."
              : "Start building your first Google Sheets-powered dashboard."}
          </p>

          <form onSubmit={handleAuthSubmit} className="form-stack">
            <label>
              Email
              <input
                type="email"
                placeholder="owner@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
              />
            </label>

            {error && <div className="error-box">{error}</div>}
            {message && <div className="success-box">{message}</div>}

            <button className="primary-button" type="submit">
              {mode === "login" ? "Login" : "Create account"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (selectedProject) {
    return (
      <main className="dashboard-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="brand-mark small">U</div>
            <div>
              <strong>UnScriptly</strong>
              <span>Control Center</span>
            </div>
          </div>

          <nav>
            <a onClick={() => setSelectedProject(null)}>Dashboard</a>
            <a
              className={setupPage === "overview" ? "active" : ""}
              onClick={() => setSetupPage("overview")}
            >
              Overview
            </a>
            <a
              className={setupPage === "google" ? "active" : ""}
              onClick={() => setSetupPage("google")}
            >
              Google + Sheet
            </a>
            <a
              className={setupPage === "app-script" ? "active" : ""}
              onClick={() => setSetupPage("app-script")}
            >
              Apps Script
            </a>
            <a
              className={setupPage === "leads-config" ? "active" : ""}
              onClick={() => setSetupPage("leads-config")}
            >
              Leads Config
            </a>
            <a
              className={setupPage === "field-mapping" ? "active" : ""}
              onClick={() => setSetupPage("field-mapping")}
            >
              Field Mapping
            </a>
            <a
              className={setupPage === "form-preview" ? "active" : ""}
              onClick={() => setSetupPage("form-preview")}
            >
              Form Preview
            </a>
            <a
              className={setupPage === "ai-plan" ? "active" : ""}
              onClick={() => setSetupPage("ai-plan")}
            >
              AI Plan
            </a>
            <a
              className={setupPage === "sync" ? "active" : ""}
              onClick={() => setSetupPage("sync")}
            >
              Sync
            </a>
          </nav>
        </aside>

        <section className="dashboard-main">
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">Project Setup</p>
              <h1>{selectedProject.projectName}</h1>
              <p className="muted">
                {selectedProject.businessName} · {selectedProject.businessType}
              </p>
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={() => setSelectedProject(null)}
            >
              Back to Dashboard
            </button>
          </header>

          <section className="setup-stepper panel">
            {(["overview", "google", "app-script", "leads-config", "field-mapping", "form-preview", "ai-plan", "sync"] as SetupPageType[]).map((step) => (
              <button
                key={step}
                className={setupPage === step ? "step-tab active" : "step-tab"}
                type="button"
                onClick={() => setSetupPage(step)}
              >
                {formatStepLabel(step)}
              </button>
            ))}
          </section>

          <section className={setupPage === "overview" ? "grid-layout" : "hidden-section"}>
            <div className="panel">
              <h2>Build Progress</h2>
              <p className="muted">
                Your dashboard is {selectedProject.setupProgress || 0}% ready.
              </p>
              <div className="progress-bar-container" style={{ height: 8, background: "#f1f5f9", borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
                 <div className="progress-bar-fill" style={{ width: `${selectedProject.setupProgress || 0}%`, height: "100%", background: "#2563eb", transition: "width 0.3s ease" }}></div>
              </div>

              <div className="setup-list" style={{ marginTop: 24 }}>
                <div className={`setup-step ${projectStatusOrder.indexOf(selectedProject.status) >= 0 ? "done" : ""}`}>Project Created</div>
                <div className={`setup-step ${projectStatusOrder.indexOf(selectedProject.status) >= 1 ? "done" : ""}`}>Connect Google</div>
                <div className={`setup-step ${projectStatusOrder.indexOf(selectedProject.status) >= 2 ? "done" : ""}`}>Select Google Sheet</div>
                <div className={`setup-step ${projectStatusOrder.indexOf(selectedProject.status) >= 3 ? "done" : ""}`}>Create Apps Script</div>
                <div className={`setup-step ${projectStatusOrder.indexOf(selectedProject.status) >= 5 ? "done" : ""}`}>Configure Leads</div>
                <div className={`setup-step ${projectStatusOrder.indexOf(selectedProject.status) >= 8 ? "done" : ""}`}>AI Build Plan</div>
                <div className={`setup-step ${projectStatusOrder.indexOf(selectedProject.status) >= 10 ? "done" : ""}`}>Sync & Launch</div>
              </div>
            </div>

            <div className="panel">
              <h2>Next Step</h2>
              <p className="muted">
                {nextAction?.desc}
              </p>

              {nextAction && (
              <button
                className="primary-button"
                type="button"
                onClick={() => setSetupPage(nextAction.page)}
                style={{ marginTop: 16, width: "100%" }}
              >
                {nextAction.label}
              </button>
              )}

              {selectedProject.status === "script_project_created" && (
              <button
                className="secondary-button"
                type="button"
                onClick={handleMockEnableLeadsModule}
                style={{ marginTop: 12, width: "100%" }}
              >
                Enable Leads Module
              </button>
              )}

              {selectedProject.appsScriptProjectId && (
                <div className="apps-script-connected-card" style={{ marginTop: 24, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
                  <div>
                    <p className="eyebrow">Apps Script Project Connected</p>
                    <h3 style={{ margin: "4px 0" }}>{selectedProject.appsScriptProjectName || getDefaultAppsScriptName(selectedProject)}</h3>
                    <p className="muted" style={{ fontSize: 13 }}>
                      This Apps Script project is connected to the selected Google Sheet.
                    </p>
                  </div>

                  <div className="sheet-link-actions" style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    <a
                      className="secondary-button link-button"
                      href={selectedProject.appsScriptUrl || getAppsScriptUrl(selectedProject.appsScriptProjectId)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ flex: 1, textAlign: "center" }}
                    >
                      Open Script
                    </a>

                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => setSetupPage("leads-config")}
                      style={{ flex: 1 }}
                    >
                      Config
                    </button>
                  </div>
                </div>
              )}

              {message && <div className="success-box" style={{ marginTop: 16 }}>{message}</div>}
              {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}

              <p className="muted" style={{ marginTop: 16 }}>
                These are currently safe mock setup steps. The next major build will replace
                them with real Google OAuth and Google Sheets API actions.
              </p>
            </div>
          </section>

          <section className={setupPage === "leads-config" ? "panel" : "hidden-section"}>
            <h2>Leads Configuration</h2>
            <p className="muted">
              Configure how UnScriptly should structure the Leads module before
              generating forms, Sheets columns, and dashboard views.
            </p>

            <div className="form-stack">
              <label>
                Leads Tab Name
                <input
                  type="text"
                  value={leadsTabName}
                  onChange={(event) => setLeadsTabName(event.target.value)}
                  placeholder="Leads"
                />
              </label>

              <div>
                <h3>Required Fields</h3>
                <p className="muted">
                  These fields are needed for the Leads module to work correctly.
                </p>

                <div className="field-grid">
                  {defaultRequiredLeadsFields.map((fieldName) => (
                    <label className="field-check" key={fieldName}>
                      <input
                        type="checkbox"
                        checked={selectedRequiredFields.includes(fieldName)}
                        onChange={() => toggleRequiredLeadField(fieldName)}
                      />
                      <span>{fieldName}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h3>Recommended Fields</h3>
                <p className="muted">
                  These fields make the dashboard more useful but can be adjusted.
                </p>

                <div className="field-grid">
                  {defaultRecommendedLeadsFields.map((fieldName) => (
                    <label className="field-check" key={fieldName}>
                      <input
                        type="checkbox"
                        checked={selectedRecommendedFields.includes(fieldName)}
                        onChange={() => toggleRecommendedLeadField(fieldName)}
                      />
                      <span>{fieldName}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label>
                Lead Statuses
                <textarea
                  value={leadStatusesText}
                  onChange={(event) => setLeadStatusesText(event.target.value)}
                  rows={7}
                  placeholder={"New\nContacted\nEstimate Scheduled\nWon\nLost"}
                />
              </label>

              <button
                className="primary-button"
                type="button"
                onClick={handleSaveLeadsConfiguration}
              >
                Save Leads Configuration
              </button>
            </div>
          </section>

          <section className={setupPage === "field-mapping" ? "panel" : "hidden-section"}>
            <h2>Leads Field Mapping</h2>
            <p className="muted">
              Map each UnScriptly Leads field to the Google Sheet column it should read from or write to.
              For now, these are mock Sheet columns. Later, UnScriptly will detect them from the connected Sheet.
            </p>

            <div className="form-stack">
              <label>
                Detected Google Sheet Columns
                <textarea
                  value={sheetColumnsText}
                  onChange={(event) => setSheetColumnsText(event.target.value)}
                  rows={8}
                  placeholder={"Lead ID\nCustomer Name\nPhone\nEmail\nStatus"}
                />
              </label>

              <div>
                <h3>Field Mapping</h3>
                <p className="muted">
                  Required fields must be mapped. Recommended fields can be mapped, skipped, or marked as new columns to add later.
                </p>

                <div className="mapping-list">
                  {Array.from(
                    new Set([...selectedRequiredFields, ...selectedRecommendedFields])
                  ).map((fieldName) => {
                    const sheetColumns = sheetColumnsText
                      .split("\n")
                      .map((column) => column.trim())
                      .filter(Boolean);

                    const isRequired = selectedRequiredFields.includes(fieldName);
                    const isSystemField = ["Lead ID", "Created At", "Updated At", "Created By"].includes(fieldName);

                    return (
                      <div className="mapping-row" key={fieldName}>
                        <div>
                          <strong>{fieldName}</strong>
                          <span>{isRequired ? "Required" : "Recommended"}</span>
                          <span style={{ color: isSystemField ? "#2563eb" : "inherit" }}>
                            {isSystemField ? "Automated System Field" : (isRequired ? "Required Form Field" : "Optional Form Field")}
                          </span>
                        </div>

                        <select
                          value={leadFieldMappings[fieldName] || ""}
                          onChange={(event) =>
                            updateLeadFieldMapping(fieldName, event.target.value)
                          }
                        >
                          <option value="">Do not map yet</option>
                          {sheetColumns.map((columnName) => (
                            <option value={columnName} key={columnName}>
                              {columnName}
                            </option>
                          ))}
                          <option value="__ADD_NEW_COLUMN__">
                            Add as new column later
                          </option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                className="primary-button"
                type="button"
                onClick={handleSaveLeadFieldMappings}
              >
                Save Field Mappings
              </button>
            </div>
          </section>

          <section className={setupPage === "form-preview" ? "panel" : "hidden-section"}>
            <h2>Generated Add Lead Form Preview</h2>
            <p className="muted">
              This preview shows the Add Lead form UnScriptly will generate inside the Apps Script dashboard.
              Fields come from your Leads configuration and field mappings.
            </p>

            <div className="generated-form-preview">
              <div className="generated-form-header">
                <div>
                  <p className="eyebrow">Preview Form</p>
                  <h3>Add Lead</h3>
                  <p className="muted">
                    Target tab: {leadsTabName.trim() || "Leads"}
                  </p>
                </div>

                <span className="status-badge">Internal Form</span>
              </div>

              <div className="form-stack">
                {Array.from(
                  new Set([...selectedRequiredFields, ...selectedRecommendedFields])
                )
                  .filter(
                    (fieldName) =>
                      !["Lead ID", "Created At", "Created By", "Updated At"].includes(
                        fieldName
                      )
                  )
                  .map((fieldName) => {
                    const isRequired = selectedRequiredFields.includes(fieldName);
                    const statuses = leadStatusesText
                      .split("\n")
                      .map((status) => status.trim())
                      .filter(Boolean);

                    if (fieldName === "Status") {
                      return (
                        <label key={fieldName}>
                          {fieldName} {isRequired ? "*" : ""}
                          <select
                            value={addLeadPreviewValues[fieldName] || ""}
                            onChange={(event) =>
                              updateAddLeadPreviewValue(fieldName, event.target.value)
                            }
                          >
                            <option value="">Select status</option>
                            {statuses.map((status) => (
                              <option value={status} key={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }

                    if (fieldName === "Notes") {
                      return (
                        <label key={fieldName}>
                          {fieldName} {isRequired ? "*" : ""}
                          <textarea
                            value={addLeadPreviewValues[fieldName] || ""}
                            onChange={(event) =>
                              updateAddLeadPreviewValue(fieldName, event.target.value)
                            }
                            rows={4}
                            placeholder="Add lead notes"
                          />
                        </label>
                      );
                    }

                    return (
                      <label key={fieldName}>
                        {fieldName} {isRequired ? "*" : ""}
                        <input
                          type={fieldName.toLowerCase().includes("date") ? "date" : "text"}
                          value={addLeadPreviewValues[fieldName] || ""}
                          onChange={(event) =>
                            updateAddLeadPreviewValue(fieldName, event.target.value)
                          }
                          placeholder={fieldName}
                        />
                      </label>
                    );
                  })}

                <button className="primary-button" type="button">
                  Submit Lead Preview
                </button>
              </div>
            </div>

            <div className="preview-meta-grid">
              <div className="setup-step">
                Form action: Create new lead record
              </div>
              <div className="setup-step">
                Save target: Google Sheet tab “{leadsTabName.trim() || "Leads"}”
              </div>
              <div className="setup-step">
                Runtime destination: Apps Script dashboard
              </div>
              <div className="setup-step">
                Current mode: Preview only
              </div>
            </div>

            <button
              className="primary-button"
              type="button"
              onClick={handleSaveAddLeadFormPreview}
              style={{ marginTop: 18 }}
            >
              Save Add Lead Form Preview
            </button>
          </section>

          <section className={setupPage === "ai-plan" ? "panel" : "hidden-section"}>
            <h2>AI Implementation Plan Preview</h2>
            <p className="muted">
              Review what UnScriptly plans to generate before Sync. This protects
              the Sheet, confirms the generated Apps Script file set, and gives the
              user a clear approval step.
            </p>

            <div className="ai-plan-actions">
              <button
                className="primary-button"
                type="button"
                onClick={handleGenerateAiImplementationPlan}
              >
                Generate AI Plan Preview
              </button>

              <button
                className="secondary-button"
                type="button"
                onClick={handleApproveAiImplementationPlan}
              >
                Approve Plan for Sync
              </button>
            </div>

            {(aiPlanGenerated ||
              selectedProject.setupStep === "ai_plan_ready" ||
              selectedProject.setupStep === "sync_ready") && (
              <div className="ai-plan-preview">
                <div className="plan-card plan-card-wide">
                  <p className="eyebrow">Plan Summary</p>
                  <h3>Leads Dashboard Implementation</h3>
                  <p className="muted">{getAiImplementationPlanPreview().summary}</p>
                </div>

                <div className="ai-plan-grid">
                  <div className="plan-card">
                    <h3>Sheet Changes</h3>
                    <ul>
                      {getAiImplementationPlanPreview().sheetChanges.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="plan-card">
                    <h3>Apps Script Files</h3>
                    <ul>
                      {getAiImplementationPlanPreview().appsScriptFiles.map((fileName) => (
                        <li key={fileName}>{fileName}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="plan-card">
                    <h3>Generated Forms</h3>
                    {getAiImplementationPlanPreview().forms.map((form) => (
                      <div className="mini-record" key={form.name}>
                        <strong>{form.name}</strong>
                        <span>Type: {form.type}</span>
                        <span>Target: {form.targetTab}</span>
                        <span>Fields: {form.fields.length}</span>
                      </div>
                    ))}
                  </div>

                  <div className="plan-card">
                    <h3>Runtime Actions</h3>
                    <ul>
                      {getAiImplementationPlanPreview().runtimeActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="plan-card">
                    <h3>Safety Checks</h3>
                    <ul>
                      {getAiImplementationPlanPreview().safetyChecks.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="plan-card">
                    <h3>Warnings</h3>
                    <ul>
                      {getAiImplementationPlanPreview().warnings.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="preview-meta-grid">
                  <div className="setup-step">
                    Plan status: {aiPlanApproved || selectedProject.setupStep === "sync_ready" ? "Approved for Sync" : "Ready for Review"}
                  </div>
                  <div className="setup-step">
                    Blockers: {getAiImplementationPlanPreview().blockers.length}
                  </div>
                  <div className="setup-step">
                    Sync allowed: {aiPlanApproved || selectedProject.setupStep === "sync_ready" ? "Yes" : "No"}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={setupPage === "google" ? "panel" : "hidden-section"}>
            <h2>Google + Sheet Setup</h2>
            <p className="muted">
              Connect Google first, then choose or create the Google Sheet this project will use.
            </p>

            {(selectedProject.status === "google_connected" ||
              Boolean(selectedProject.googleSheetId) ||
              selectedProject.status === "script_project_created" ||
              selectedProject.status === "leads_configured" ||
              selectedProject.status === "synced") && (
              <div className="connected-card">
                <div>
                  <p className="eyebrow">Google Connected</p>
                  <h3>Google account is connected</h3>
                  <p className="muted">
                    UnScriptly can now create or update this project’s Google Sheet and Apps Script project.
                  </p>
                </div>
                <span className="connected-badge">Connected</span>
              </div>
            )}

            <div className="setup-action-stack">
              <button
                className="primary-button"
                type="button"
                onClick={handleRealConnectGoogle}
              >
                {(selectedProject.status === "google_connected" ||
                  Boolean(selectedProject.googleSheetId) ||
                  selectedProject.status === "script_project_created" ||
                  selectedProject.status === "leads_configured" ||
                  selectedProject.status === "synced")
                  ? "Reconnect Google"
                  : "Connect Google"}
              </button>

              <button
                className="secondary-button"
                type="button"
                onClick={handleRealChooseGoogleSheet}
              >
                Create New Sheet
              </button>

                <div className="sheet-connect-card">
                  <h3>Connect Existing Sheet</h3>
                  <p className="muted">
                    Paste a Google Sheet URL or Sheet ID. The Sheet must belong to the connected Google account.
                  </p>

                  <input
                    className="sheet-url-input"
                    value={existingSheetInput}
                    onChange={(event) => setExistingSheetInput(event.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleConnectExistingSheet}
                  >
                    Connect Existing Sheet
                  </button>
                </div>

                {selectedProject.googleSheetId && (
                  <div className="sheet-connected-card">
                    <div>
                      <p className="eyebrow">Connected Google Sheet</p>
                      <h3>{getDisplaySheetName(selectedProject)}</h3>
                      <p className="muted">
                        Review the connected Sheet before continuing to Apps Script.
                      </p>
                      <p className="muted sheet-id-label">
                        Sheet ID: {selectedProject.googleSheetId}
                      </p>
                      <p className="muted sheet-id-label">
                        Sheet URL: {selectedProject.googleSheetUrl || getSheetUrl(selectedProject.googleSheetId)}
                      </p>
                    </div>

                    <div className="sheet-link-actions">
                      <a
                        className="secondary-button link-button"
                        href={selectedProject.googleSheetUrl || getSheetUrl(selectedProject.googleSheetId)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Google Sheet
                      </a>

                      <button
                        className="primary-button"
                        type="button"
                        onClick={handleContinueToAppsScript}
                      >
                        Continue to Apps Script
                      </button>
                    </div>
                  </div>
                )}

            </div>

            {message && <div className="success-box" style={{ marginTop: 16 }}>{message}</div>}
            {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
          </section>

          <section className={setupPage === "app-script" ? "panel" : "hidden-section"}>
            <h2>Apps Script Project</h2>
            <p className="muted">
              Create or connect the Apps Script project that will host this client-owned automation and dashboard.
            </p>

            <button
              className="primary-button"
              type="button"
              onClick={handleMockCreateAppsScriptProject}
            >
              Create Apps Script Project
            </button>

            {message && <div className="success-box" style={{ marginTop: 16 }}>{message}</div>}
            {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
          </section>

                    <section className={setupPage === "sync" ? "panel" : "hidden-section"}>
            <h2>Sync Center Preview</h2>
            <p className="muted">
              Review exactly what UnScriptly will do before any real Sync touches
              Google Sheets or Apps Script. This is a safety gate, not the real Sync.
            </p>

            <div className="sync-status-banner">
              <div>
                <p className="eyebrow">Sync Status</p>
                <h3>
                  {getSyncCenterPreview().isPlanApproved
                    ? "Ready for Pre-Sync Review"
                    : "Waiting on AI Plan Approval"}
                </h3>
                <p className="muted">
                  Real Sync remains locked until review is complete. This project has passed the safe Sync MVP once synced.
                </p>
              </div>

              <span className={getSyncCenterPreview().isPlanApproved ? "sync-pill ready" : "sync-pill blocked"}>
                {getSyncCenterPreview().isPlanApproved ? "Ready" : "Blocked"}
              </span>
            </div>

            <div className="sync-grid">
              <div className="plan-card">
                <h3>Readiness Checklist</h3>
                <div className="sync-check-list">
                  {getSyncCenterPreview().readinessItems.map((item) => (
                    <div className={item.ready ? "sync-check done" : "sync-check"} key={item.label}>
                      <span>{item.ready ? "✓" : "•"}</span>
                      <strong>{item.label}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="plan-card">
                <h3>Sheet Changes Preview</h3>
                <ul>
                  {getSyncCenterPreview().sheetChanges.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="plan-card">
                <h3>Apps Script Changes Preview</h3>
                <ul>
                  {getSyncCenterPreview().scriptChanges.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="plan-card">
                <h3>Safety Rules</h3>
                <ul>
                  {getSyncCenterPreview().safetyRules.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            {getSyncCenterPreview().blockedReasons.length > 0 && (
              <div className="sync-blockers">
                <h3>Blocked Reasons</h3>
                <ul>
                  {getSyncCenterPreview().blockedReasons.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="sync-confirm-box">
              <h3>What happens next?</h3>
              <p className="muted">
                Saving this review does not run Sync. It only records that the user
                has reviewed the proposed Sheet changes, Apps Script changes, safety
                rules, and blockers. The next build will add the real Sync engine.
              </p>

              <button
                className="primary-button"
                type="button"
                onClick={handleSaveSyncCenterPreview}
              >
                Save Pre-Sync Review
              </button>

              <button
                className="secondary-button"
                type="button"
                onClick={handleRunSyncMvp}
                style={{ marginLeft: 12 }}
              >
                Run Real Google Sync
              </button>
            </div>

            {message && <div className="success-box" style={{ marginTop: 16 }}>{message}</div>}
            {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
          </section>

<section className="panel project-record-panel">
            <h2>Project Record</h2>
            <div className="setup-list">
              <div className="setup-step">Project ID: {selectedProject.id}</div>
              <div className="setup-step">Status: {selectedProject.status}</div>
              <div className="setup-step">Setup Step: {selectedProject.setupStep}</div>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">U</div>
          <div>
            <strong>UnScriptly</strong>
            <span>Control Center</span>
          </div>
        </div>

        <nav>
        <a className={!isCreatingOrg ? "active" : ""} onClick={() => { setIsCreatingOrg(false); setSelectedProject(null); }}>Dashboard</a>
        <a onClick={() => { setIsCreatingOrg(false); setSelectedProject(null); }}>Projects</a>
        <a onClick={() => { setIsCreatingOrg(true); setSelectedProject(null); }}>+ New Workspace</a>
        <a className="locked">Features</a>
        <a className="locked">Templates</a>
          <a className="locked">AI Plan</a>
          <a className="locked">Sync</a>
          <a className="locked">Deploy</a>
          <a>Settings</a>
        </nav>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Projects</h1>
            <p className="muted">
              Build and manage your Google Sheets-powered dashboards.
            </p>
          </div>

          <div className="user-menu">
            <div className="avatar">{userInitial}</div>
            <div>
              <OrganizationSwitcher 
                activeOrgId={activeOrgId} 
                userOrgs={userOrgs} 
                onOrgChange={setActiveOrgId} 
              />
              <strong>{user.email}</strong>
              <button onClick={handleLogout} type="button">
                Logout
              </button>
            </div>
          </div>
        </header>

      {isCreatingOrg ? (
        <section className="grid-layout">
          <div className="panel" style={{ maxWidth: 500 }}>
            <h2>Create New Workspace</h2>
            <p className="muted">Workspaces are isolated environments for your business projects. You can invite team members and manage multiple projects within a workspace.</p>
            <form onSubmit={handleCreateWorkspace} className="form-stack" style={{ marginTop: 24 }}>
              <label>
                Workspace Name
                <input 
                  type="text" 
                  value={newOrgNameInput} 
                  onChange={(e) => setNewOrgNameInput(e.target.value)} 
                  placeholder="e.g. Acme Home Services" 
                  required 
                  style={{ marginTop: 8 }}
                />
              </label>
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button className="primary-button" type="submit" style={{ flex: 1 }}>Create Workspace</button>
                <button className="secondary-button" type="button" onClick={() => setIsCreatingOrg(false)} style={{ flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        </section>
      ) : (
        <>
        <section className="grid-layout">
          <div className="panel">
            <h2>Create Project</h2>
            <p className="muted">
              Start with one business, one Google Sheet, and one Apps Script
              dashboard.
            </p>

            <div className="form-stack">
              <label>
                Project Name
                <input
                  type="text"
                  placeholder="ABC Roofing Dashboard"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  required
                />
              </label>

              <label>
                Business Name
                <input
                  type="text"
                  placeholder="ABC Roofing"
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  required
                />
              </label>

              <label>
                Business Type
                <select
                  value={businessType}
                  onChange={(event) => setBusinessType(event.target.value)}
                >
                  <option>Roofing</option>
                  <option>HVAC</option>
                  <option>Plumbing</option>
                  <option>Electrical</option>
                  <option>Landscaping</option>
                  <option>Cleaning</option>
                  <option>Pest Control</option>
                  <option>Pool Service</option>
                  <option>Handyman</option>
                  <option>Other Home Service</option>
                </select>
              </label>

              <button
                className="primary-button"
                type="button"
                onClick={handleCreateProject}
              >
                Create Project
              </button>
            </div>

            {error && <div className="error-box">{error}</div>}
            {message && <div className="success-box">{message}</div>}
          </div>

          <div className="panel">
            <h2>Setup Path</h2>
            <p className="muted">
              Each project moves through the UnScriptly build lifecycle.
            </p>

            <div className="setup-list">
              <div className="setup-step done">Project Created</div>
              <div className="setup-step">Connect Google</div>
              <div className="setup-step">Create New Sheet</div>
              <div className="setup-step">Create App Project</div>
              <div className="setup-step">Enable Leads</div>
              <div className="setup-step locked">Forms</div>
              <div className="setup-step locked">AI Plan</div>
              <div className="setup-step locked">Sync</div>
              <div className="setup-step locked">Deploy</div>
            </div>
          </div>

          <div className="panel">
            <h2>Invite Member</h2>
            <p className="muted">Add a user to the current organization.</p>
            <div className="form-stack">
              <label>
                Email Address
                <input 
                  type="email" 
                  value={inviteEmail} 
                  onChange={(e) => setInviteEmail(e.target.value)} 
                  placeholder="member@company.com"
                />
              </label>
              <label>
                Role
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="Viewer">Viewer</option>
                  <option value="Member">Member</option>
                  <option value="Admin">Admin</option>
                  <option value="Owner">Owner</option>
                </select>
              </label>
              <button className="secondary-button" type="button" onClick={handleInviteUser}>
                Invite User
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Workspace Settings</h2>
                <p className="muted">Manage workspace name and access.</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="secondary-button" type="button" onClick={handleLeaveOrganization}>
                  Leave Organization
                </button>
                <button className="secondary-button danger" type="button" onClick={handleDeleteOrganization}>
                  Delete Organization
                </button>
              </div>
            </div>

            <div className="form-stack" style={{ marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
              <label>
                Workspace Name
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <input 
                    type="text" 
                    value={orgRenameValue} 
                    onChange={(e) => setOrgRenameValue(e.target.value)} 
                    placeholder="Workspace Name"
                  />
                  <button className="secondary-button" onClick={handleRenameOrganization}>Update</button>
                </div>
              </label>
            </div>

            <h3>Members</h3>
            <div className="mapping-list">
              {orgMembers.map((member) => (
                <div className="mapping-row" key={member.userId}>
                  <div>
                    <strong>{member.email} {user?.uid === member.userId && "(You)"}</strong>
                    <select
                      value={member.role}
                      onChange={(e) => handleUpdateMemberRole(member.userId, e.target.value as OrganizationRole)}
                      disabled={user?.uid === member.userId}
                      style={{ marginLeft: 8, padding: "2px 4px", borderRadius: 4, border: "1px solid #ccc" }}
                    >
                      <option value="Owner">Owner</option>
                      <option value="Admin">Admin</option>
                      <option value="Member">Member</option>
                      <option value="Viewer">Viewer</option>
                    </select>
                  </div>
                  {user?.uid !== member.userId && (
                    <button 
                      className="text-button danger" 
                      onClick={() => handleRemoveMember(member.userId)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel project-panel">
          <div className="panel-header">
            <div>
              <h2>Your Projects</h2>
              <p className="muted">
                Continue setup or review project progress.
              </p>
            </div>
            <span className="count-pill">{projects.length} total</span>
          </div>

          {loadingProjects ? (
            <p className="muted">Loading projects...</p>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <h3>No projects yet</h3>
              <p>
                Create your first UnScriptly project to begin connecting Google,
                mapping Leads, and preparing your dashboard.
              </p>
            </div>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <article className="project-card" key={project.id} style={{ display: "flex", flexDirection: "column", padding: 24, borderRadius: 16, border: "1px solid #e5e7eb", backgroundColor: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", transition: "all 0.2s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>{project.projectName}</h3>
                      <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                        {project.businessName} · {project.businessType}
                      </p>
                    </div>
                    <span className="status-badge" style={{ textTransform: "capitalize", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, backgroundColor: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb" }}>
                      {project.status.replace("_", " ")}
                    </span>
                  </div>

                  <div style={{ flex: 1 }}>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                      <span>Build Progress</span>
                      <strong>{project.setupProgress || 0}%</strong>
                    </p>
                    <div className="progress-bar-mini" style={{ height: 8, background: "#f1f5f9", borderRadius: 4, marginBottom: 20, overflow: "hidden" }}>
                       <div className="progress-bar-fill" style={{ width: `${project.setupProgress || 0}%`, height: "100%", background: "#2563eb", transition: "width 0.4s ease" }}></div>
                    </div>
                  </div>

                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      setSelectedProject(project);
                      setSetupPage("overview");
                    }}
                    style={{ width: "100%", marginTop: "auto" }}
                  >
                    {project.status === "live" ? "Manage Dashboard" : "Continue Setup"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        </>
      )}
      </section>
    </main>
  );
}

export default App;
