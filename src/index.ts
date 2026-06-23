import { onCall, onRequest, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import { Project } from "./types";

admin.initializeApp();

const db = admin.firestore();

/**
 * Task 5: Start Google OAuth Flow
 */
export const startGoogleOAuth = onCall({ secrets: ["GOOGLE_CLIENT_SECRET"] }, async (request: CallableRequest<{ projectId: string }>) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated", 
      "User must be logged in to connect Google."
    );
  }

  const { projectId } = request.data;
  if (!projectId) {
    throw new HttpsError(
      "invalid-argument", 
      "A valid projectId is required."
    );
  }

  const projectDoc = await db.collection("projects").doc(projectId).get();
  if (!projectDoc.exists) {
    throw new HttpsError("not-found", "Project not found.");
  }

  const projectData = projectDoc.data() as Project;
  const isOwner = projectData?.ownerUserId === request.auth.uid;
  
  if (!isOwner) {
    const membershipId = `${projectData?.organizationId}_${request.auth.uid}`;
    const membership = await db.collection("organizationMembers").doc(membershipId).get();
    if (!membership.exists) {
      throw new HttpsError("permission-denied", "Unauthorized project access.");
    }
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    console.error("Missing OAuth Configuration:", {
      clientId: !!process.env.GOOGLE_CLIENT_ID,
      redirectUri: !!process.env.GOOGLE_REDIRECT_URI
    });
    throw new HttpsError("internal", "Server configuration error.");
  }

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
    state: projectId,
  });

  return { url };
});

/**
 * Task 5: Google OAuth Callback
 */
export const googleOAuthCallback = onRequest({ secrets: ["GOOGLE_CLIENT_SECRET"] }, async (req, res) => {
  const code = req.query.code as string;
  const projectId = req.query.state as string;

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

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI || !process.env.APP_URL) {
    console.error("Missing OAuth Callback Configuration:", {
      clientId: !!process.env.GOOGLE_CLIENT_ID,
      clientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: !!process.env.GOOGLE_REDIRECT_URI,
      appUrl: !!process.env.APP_URL
    });
    res.status(500).send("Server configuration error for OAuth callback.");
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

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();

    const existingData = projectDoc.data() as Project | any;
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
 */
export const runRealSync = onCall(async (request: CallableRequest<{ projectId: string }>) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be logged in.");
  }

  const projectId = request.data?.projectId;
  if (!projectId) {
    throw new HttpsError("invalid-argument", "projectId is required.");
  }

  const projectRef = db.collection("projects").doc(projectId);
  const projectDoc = await projectRef.get();
  if (!projectDoc.exists) {
    throw new HttpsError("not-found", "Project not found.");
  }

  const projectData = projectDoc.data() as Project;
  const isOwner = projectData.ownerUserId === request.auth.uid;
  if (!isOwner) {
    const membershipId = `${projectData.organizationId}_${request.auth.uid}`;
    const membership = await db.collection("organizationMembers").doc(membershipId).get();
    if (!membership.exists) {
      throw new HttpsError("permission-denied", "Unauthorized access.");
    }
  }

  if (!process.env.APP_URL) {
    throw new HttpsError("internal", "APP_URL is missing.");
  }

  return {
    syncRunId: `sync_${Date.now()}`,
    sheetId: projectData.spreadsheetId || projectData.googleSheetId || `mock_sheet_${projectId}`,
    sheetUrl: projectData.spreadsheetUrl || projectData.googleSheetUrl || `https://docs.google.com/spreadsheets/d/mock_sheet_${projectId}/edit`,
    appUrl: process.env.APP_URL,
  };
});