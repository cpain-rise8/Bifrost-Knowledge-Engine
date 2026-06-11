/**
 * BIFROST FIRESTORE PROXY ENGINE (Saved in Firestore.gs)
 */

const GCP_PROJECT_ID = 'bifrost-intelligence-engine'; 
const CLOUD_RUN_FUNCTION_URL = "https://bifrost-vector-search-47873772432.us-central1.run.app"; 
const PROXY_SECRET_TOKEN = "Bifrost_Secure_Bridge_Token_2026"; 

/**
 * Routes standard JSON updates to the Cloud Run proxy to bypass REST limitations
 */
function createFirestoreDocument(collection, documentId, dataObject) {
  try {
    // Standardize JavaScript date objects to basic ISO string text format before transit
    if (dataObject.last_updated instanceof Date) {
      dataObject.last_updated = dataObject.last_updated.toISOString();
    }

    const payload = {
      "action": "write",
      "collection": collection,
      "document_id": documentId,
      "data": dataObject
    };
    
    const options = {
      "method": "post",
      "contentType": "application/json",
      "headers": { "X-Bifrost-Key": PROXY_SECRET_TOKEN },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    const response = UrlFetchApp.fetch(CLOUD_RUN_FUNCTION_URL, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode === 200) {
      Logger.log(`--> [Proxy Write Success] Handled document "${documentId}".`);
      return true;
    } else {
      Logger.log(`⚠️ Proxy Write Failure [Code ${responseCode}]: ${response.getContentText()}`);
      return false;
    }
  } catch (e) {
    Logger.log(`Critical Proxy Write Connection Exception: ${e.toString()}`);
    return false;
  }
}

/**
 * Proxy-routed safe deletion mechanism
 */
function deleteFirestoreDocument(collection, documentId) {
  try {
    const payload = {
      "action": "delete",
      "collection": collection,
      "document_id": documentId
    };
    
    const options = {
      "method": "post",
      "contentType": "application/json",
      "headers": { "X-Bifrost-Key": PROXY_SECRET_TOKEN },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    UrlFetchApp.fetch(CLOUD_RUN_FUNCTION_URL, options);
  } catch (e) {
    Logger.log(`Proxy Delete Connection Exception: ${e.toString()}`);
  }
}

/**
 * CONNECTION VERIFICATION HARNESS
 */
function testFirestoreConnection() {
  Logger.log("Starting secure handshake write test with Firestore instance via Cloud Run Proxy...");
  
  const mock768Vector = new Array(768).fill(0.0123);
  const mockDocChunk = {
    "source_type": "standup_note",
    "doc_title": "Bifrost Connectivity Verification Standup",
    "last_updated": new Date(),
    "text_chunk": "This is a validation transaction to guarantee Cloud Run can parse vectors natively via gRPC.",
    "embedding_vector": mock768Vector 
  };
  
  const mockDocId = "verification_test_" + new Date().getTime();
  const writeSuccess = createFirestoreDocument("knowledge_index", mockDocId, mockDocChunk);
  
  if (writeSuccess) {
    Logger.log("🎉 SUCCESS: Connection verified. Cloud Run has written your true Native Vector.");
  } else {
    Logger.log("❌ ERROR: Handshake failed. Review the proxy logging trace details.");
  }
}

/**
 * DOCUMENT EXISTENCE CHECKER
 * Lightweight HEAD lookup remains on direct REST as it uses simple paths without data payloads.
 */
function checkIfDocumentExists(collection, documentId) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${GCP_PROJECT_ID}/databases/(default)/documents/${collection}/${documentId}`;
    const options = {
      "method": "get",
      "headers": { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      "muteHttpExceptions": true 
    };
    const response = UrlFetchApp.fetch(url, options);
    return response.getResponseCode() === 200;
  } catch (e) {
    Logger.log(`Error checking document existence: ${e.toString()}`);
    return false;
  }
}
