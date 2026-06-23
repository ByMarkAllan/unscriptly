"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProject = normalizeProject;
exports.prepareProjectUpdate = prepareProjectUpdate;
/**
 * Normalizes project data from Firestore, ensuring required fields exist
 * and providing compatibility for legacy field names.
 */
function normalizeProject(data) {
    return {
        ...data,
        spreadsheetId: data.spreadsheetId || data.googleSheetId || null,
        spreadsheetName: data.spreadsheetName || data.googleSheetName || null,
        spreadsheetUrl: data.spreadsheetUrl || data.googleSheetUrl || null,
        scriptProjectId: data.scriptProjectId || data.appsScriptProjectId || null,
        scriptProjectName: data.scriptProjectName || data.appsScriptProjectName || null,
        scriptProjectUrl: data.scriptProjectUrl || data.appsScriptUrl || null,
        status: data.status || "draft",
        setupProgress: data.setupProgress || 0,
    };
}
/**
 * Prepares project updates for Firestore, writing to both normalized
 * and legacy fields for backwards compatibility during MVP1.
 */
function prepareProjectUpdate(updates) {
    const result = { ...updates };
    if (updates.spreadsheetId !== undefined)
        result.googleSheetId = updates.spreadsheetId;
    if (updates.spreadsheetName !== undefined)
        result.googleSheetName = updates.spreadsheetName;
    if (updates.spreadsheetUrl !== undefined)
        result.googleSheetUrl = updates.spreadsheetUrl;
    if (updates.scriptProjectId !== undefined)
        result.appsScriptProjectId = updates.scriptProjectId;
    if (updates.scriptProjectName !== undefined)
        result.appsScriptProjectName = updates.scriptProjectName;
    if (updates.scriptProjectUrl !== undefined)
        result.appsScriptUrl = updates.scriptProjectUrl;
    return result;
}
