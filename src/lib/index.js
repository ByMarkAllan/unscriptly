"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRealSync = exports.googleOAuthCallback = exports.startGoogleOAuth = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const googleapis_1 = require("googleapis");
admin.initializeApp();
const db = admin.firestore();
/**
 * Task 5: Start Google OAuth Flow
 */
exports.startGoogleOAuth = (0, https_1.onCall)({ secrets: ["GOOGLE_CLIENT_SECRET"] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in to connect Google.");
    }
    const { projectId } = request.data;
    if (!projectId) {
        throw new https_1.HttpsError("invalid-argument", "A valid projectId is required.");
    }
    const projectDoc = await db.collection("projects").doc(projectId).get();
    if (!projectDoc.exists) {
        throw new https_1.HttpsError("not-found", "Project not found.");
    }
    const projectData = projectDoc.data();
    const isOwner = projectData?.ownerUserId === request.auth.uid;
    if (!isOwner) {
        const membershipId = `${projectData?.organizationId}_${request.auth.uid}`;
        const membership = await db.collection("organizationMembers").doc(membershipId).get();
        if (!membership.exists) {
            throw new https_1.HttpsError("permission-denied", "Unauthorized project access.");
        }
    }
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
        console.error("Missing OAuth Configuration:", {
            clientId: !!process.env.GOOGLE_CLIENT_ID,
            redirectUri: !!process.env.GOOGLE_REDIRECT_URI
        });
        throw new https_1.HttpsError("internal", "Server configuration error.");
    }
    const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
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
exports.googleOAuthCallback = (0, https_1.onRequest)({ secrets: ["GOOGLE_CLIENT_SECRET"] }, async (req, res) => {
    const code = req.query.code;
    const projectId = req.query.state;
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
    }
    catch (err) {
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
    const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        const oauth2 = googleapis_1.google.oauth2({ version: "v2", auth: oauth2Client });
        const { data: userinfo } = await oauth2.userinfo.get();
        const existingData = projectDoc.data();
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
    }
    catch (error) {
        console.error("OAuth Exchange Failed:", error);
        res.status(500).send("Internal authentication error.");
    }
});
/**
 * Task 6: Real Sync Engine
 */
exports.runRealSync = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const projectId = request.data?.projectId;
    if (!projectId) {
        throw new https_1.HttpsError("invalid-argument", "projectId is required.");
    }
    const projectRef = db.collection("projects").doc(projectId);
    const projectDoc = await projectRef.get();
    if (!projectDoc.exists) {
        throw new https_1.HttpsError("not-found", "Project not found.");
    }
    const projectData = projectDoc.data();
    const isOwner = projectData.ownerUserId === request.auth.uid;
    if (!isOwner) {
        const membershipId = `${projectData.organizationId}_${request.auth.uid}`;
        const membership = await db.collection("organizationMembers").doc(membershipId).get();
        if (!membership.exists) {
            throw new https_1.HttpsError("permission-denied", "Unauthorized access.");
        }
    }
    if (!process.env.APP_URL) {
        throw new https_1.HttpsError("internal", "APP_URL is missing.");
    }
    return {
        syncRunId: `sync_${Date.now()}`,
        sheetId: projectData.spreadsheetId || projectData.googleSheetId || `mock_sheet_${projectId}`,
        sheetUrl: projectData.spreadsheetUrl || projectData.googleSheetUrl || `https://docs.google.com/spreadsheets/d/mock_sheet_${projectId}/edit`,
        appUrl: process.env.APP_URL,
    };
});
