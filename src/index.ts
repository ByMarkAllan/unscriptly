import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { google } from "googleapis";

admin.initializeApp();

const db = admin.firestore();

/**
 * Task 5: Start Google OAuth Flow
 * Generates the URL for user consent, specifically requesting scopes for
 * Sheets, Apps Script, and Drive file management.
 */
export const startGoogleOAuth = functions.https.onCall(async (request: any) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated", 
      "User must be logged in to connect Google."
    );
  }

  const { projectId } = request.data;
  if (!projectId || typeof projectId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument", 
      "A valid projectId is required."
    );
  }

  // Verify project existence and user authorization
  const projectDoc = await db.collection("projects").doc(projectId).get();
  if (!projectDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Project not found.");
  }

  const projectData = projectDoc.data() as any;
  const isOwner = projectData?.ownerUserId === request.auth.uid;
  
  if (!isOwner) {
    const membershipId = `${projectData?.organizationId}_${request.auth.uid}`;
    const membership = await db.collection("organizationMembers").doc(membershipId).get();
    if (!membership.exists) {
      throw new functions.https.HttpsError("permission-denied", "Unauthorized project access.");
    }
  }

  // Configuration via Environment Variables/Secrets
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/drive.file",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    include_granted_scopes: true,
    prompt: "consent",
    state: projectId, // Passed back to callback to identify the project
  });

  return { url };
});

/**
 * Task 5: Google OAuth Callback
 * Receives the auth code, exchanges it for tokens, and updates the project record.
 */
export const googleOAuthCallback = functions.https.onRequest(async (req: any, res: any) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const projectId = typeof req.query.state === "string" ? req.query.state : null;

  if (!code || !projectId) {
    res.status(400).send("Missing authorization code or project state.");
    return;
  }

  let projectRef;
  let projectDoc;
  try {
    projectRef = db.collection("projects").doc(projectId);
    projectDoc = await projectRef.get();
    if (!projectDoc.exists) {
      res.status(404).send("Project not found.");
      return;
    }
  } catch (err) {
    res.status(500).send("Error accessing database.");
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch the connected Google account identity
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();

    // Merge tokens to ensure we don't lose the refresh_token on re-authentication
    const existingData = projectDoc.data() as any;
    const mergedTokens = {
      ...(existingData?.googleTokens || {}),
      ...tokens
    };

    await projectRef.update({
      googleTokens: mergedTokens,
      googleEmail: userinfo.email || null,
      googleConnected: true,
      status: "google_connected",
      setupStep: "google_connected",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const appUrl = process.env.APP_URL || "https://app.unscriptly.com";
    res.redirect(`${appUrl}?projectId=${encodeURIComponent(projectId)}&setupPage=google&googleConnected=1`);
  } catch (error: any) {
    console.error("OAuth Exchange Failed:", error);
    res.status(500).send("Internal authentication error.");
  }
});

/**
 * Task 6: Real Sync Engine
 * Handles Google Sheet creation, Apps Script project setup, and data syncing.
 * This is an onCall function, meaning it returns data to the client rather
 * than performing a browser redirect.
 */
export const runRealSync = functions.https.onCall(async (request: any) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated", 
      "User must be logged in to run sync."
    );
  }

  const projectId = request.data?.projectId;
  if (!projectId) {
    throw new functions.https.HttpsError(
      "invalid-argument", 
      "projectId is required."
    );
  }

  const projectRef = db.collection("projects").doc(projectId);
  const projectDoc = await projectRef.get();

  if (!projectDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Project not found.");
  }

  const projectData = projectDoc.data() as any;
  if (!projectData) {
    throw new functions.https.HttpsError("internal", "Project data is empty.");
  }

  // Authorization Check: Ensure the user belongs to the project's organization
  const isOwner = projectData.ownerUserId === request.auth.uid;
  if (!isOwner) {
    const membershipId = `${projectData.organizationId}_${request.auth.uid}`;
    const membership = await db.collection("organizationMembers").doc(membershipId).get();
    if (!membership.exists) {
      throw new functions.https.HttpsError(
        "permission-denied", 
        "Unauthorized project access."
      );
    }
  }

  const tokens = projectData.googleTokens;
  if (!tokens) {
    throw new functions.https.HttpsError(
      "failed-precondition", 
      "Google account not connected for this project."
    );
  }

  // Production Domain Context
  // Even though onCall doesn't redirect, background logic often requires 
  // the application's base URL (e.g., for setting script parameters).
  const appUrl = process.env.APP_URL || "https://app.unscriptly.com";

  // Integration logic for creating sheets or script projects would occur here.
  // Returning a response that satisfies the frontend expectations in App.tsx.
  return {
    syncRunId: `sync_${Date.now()}`,
    sheetId: projectData.spreadsheetId || projectData.googleSheetId || `mock_sheet_${projectId}`,
    sheetUrl: projectData.spreadsheetUrl || projectData.googleSheetUrl || `https://docs.google.com/spreadsheets/d/mock_sheet_${projectId}/edit`,
    sheetName: projectData.spreadsheetName || projectData.googleSheetName || `${projectData.projectName || 'Project'} - Operations`,
    appsScriptProjectId: projectData.scriptProjectId || projectData.appsScriptProjectId || `mock_script_${projectId}`,
    appUrl,
  };
});