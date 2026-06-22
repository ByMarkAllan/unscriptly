import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

/**
 * Task 11: Start Google OAuth Flow
 * This callable generates a mock OAuth URL to begin the connection process.
 */
export const startGoogleOAuth = functions.https.onCall(async (request: any) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be signed in.");
  }

  const projectId = request.data?.projectId;
  if (!projectId) {
    throw new functions.https.HttpsError("invalid-argument", "Project ID is required.");
  }

  try {
    // For MVP1, we simulate the OAuth URL generation.
    // In a real implementation, this would use the googleapis library 
    // to generate a signed URL with correct scopes and state.
    
    // The state parameter should include the project ID and organization context.
    const state = projectId; 
    
    // Mocking the URL. In production, this points to accounts.google.com
    // For this debug build, we point to our own callback directly with mock data.
    const callbackUrl = `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/googleOAuthCallback`;
    const mockOAuthUrl = `${callbackUrl}?code=mock_auth_code&state=${state}`;

    return { url: mockOAuthUrl };
  } catch (error: any) {
    console.error("startGoogleOAuth Error:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

/**
 * Task 11: Google OAuth Callback
 * Handles the redirect from Google, exchanges the code, and saves the connection.
 */
export const googleOAuthCallback = functions.https.onRequest(async (req, res) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string; // Project ID passed in state

    if (!code || !state) {
      res.status(400).send("Missing authentication code or state.");
      return;
    }

    // 1. Fetch project to identify organization
    const projectDoc = await db.collection("projects").doc(state).get();
    if (!projectDoc.exists) {
      res.status(404).send("Project not found.");
      return;
    }
    const projectData = projectDoc.data();
    const orgId = projectData?.organizationId;

    // 2. Create/Update Google Connection record
    const connectionId = `conn_${orgId}`;
    await db.collection("googleConnections").doc(connectionId).set({
      id: connectionId,
      organizationId: orgId,
      googleEmail: "owner@company.com", // Mocked profile
      status: "connected",
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 3. Link connection to project and update status
    await db.collection("projects").doc(state).update({
      googleConnectionId: connectionId,
      status: "google_connected",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 4. Redirect back to the frontend
    // Use the environment-aware base URL
    const frontendUrl = "https://app.unscriptly.com"; 
    res.redirect(`${frontendUrl}/?projectId=${state}&googleConnected=1&setupPage=google`);
  } catch (error) {
    console.error("googleOAuthCallback Error:", error);
    res.status(500).send("Internal Server Error during authentication.");
  }
});

/**
 * Task 13: Run Real Sync (Legacy compatibility)
 * Creates a mock sheet and script for the project.
 */
export const runRealSync = functions.https.onCall(async (request: any) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be signed in.");
  }

  const projectId = request.data?.projectId;
  
  // Mocking the creation of Google assets
  const sheetId = `mock-sheet-${projectId}-${Date.now()}`;
  const scriptId = `mock-script-${projectId}-${Date.now()}`;

  return {
    success: true,
    syncRunId: `run_${Date.now()}`,
    sheetId,
    appsScriptProjectId: scriptId,
    title: "Leads Dashboard - UnScriptly Operations"
  };
});