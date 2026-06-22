const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "unscriptly",
});

const db = admin.firestore();
const projectId = process.argv[2];

async function main() {
  if (!projectId) {
    throw new Error("Missing project ID.");
  }

  const projectSnap = await db.collection("projects").doc(projectId).get();
  const featureSnap = await db.collection("featureConfigs").doc(projectId + "_leads").get();
  const mappingSnap = await db.collection("mappings").doc(projectId + "_leads").get();
  const formSnap = await db.collection("formConfigs").doc(projectId + "_leads_add").get();

  const project = projectSnap.data();

  console.log("\nProject:");
  console.log({
    exists: projectSnap.exists,
    projectName: project?.projectName,
    businessName: project?.businessName,
    status: project?.status,
    setupStep: project?.setupStep,
    googleSheetId: project?.googleSheetId,
    appsScriptProjectId: project?.appsScriptProjectId,
  });

  console.log("\nLeads Feature Config:");
  console.log(featureSnap.exists ? featureSnap.data() : "MISSING");

  console.log("\nField Mapping:");
  console.log(mappingSnap.exists ? mappingSnap.data() : "MISSING");

  console.log("\nAdd Lead Form Config:");
  console.log(formSnap.exists ? formSnap.data() : "MISSING");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
