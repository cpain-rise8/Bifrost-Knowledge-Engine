/**
 * BIFROST STATEFUL CURSOR INGESTION PIPELINE (Daily Incremental Sync Edition)
 */

const GEMINI_API_KEY = 'AIzaSyAAFS751c3mUckE_1NBCq9wxyQwq_O2o6k';
const DAILY_STANDUPS_FOLDER_ID = '1_lb5dcqX4OAyOgw44n61rDR1ocFnTY_n';

/**
 * BACKGROUND STATEFUL CRON JOB
 */
function runDailyIngestion() {
  const MAX_FILES_PER_RUN = 10; // Safely runs within the 6-minute Google Apps Script limit
  const scriptProperties = PropertiesService.getScriptProperties();
  
  try {
    let files;
    // 🧠 THE MARKER QUERY: Check if a continuation token from an interrupted run is stored in memory
    const savedToken = scriptProperties.getProperty('BACKLOG_DRIVE_CURSOR');
    
    if (savedToken) {
      Logger.log("🔄 Found active state marker. Resuming backlog stream exactly where we left off...");
      files = DriveApp.continueFileIterator(savedToken);
    } else {
      // Establish a clean search query targeting just the immediate rolling daily window
      const folder = DriveApp.getFolderById(DAILY_STANDUPS_FOLDER_ID);
      
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - 3); // 🧠 DAILY ADJUSTMENT: Look back 3 days to safely bridge weekend gaps
      const formattedDate = targetDate.toISOString().split('T')[0];
      
      const searchQuery = `mimeType = 'application/vnd.google-apps.document' and modifiedDate > '${formattedDate}'`;
      Logger.log(`🎬 Initializing incremental daily scan (Targeting files modified since ${formattedDate})...`);
      files = folder.searchFiles(searchQuery);
    }
    
    let filesProcessedThisRun = 0;
    
    while (files.hasNext()) {
      if (filesProcessedThisRun >= MAX_FILES_PER_RUN) {
        const continuationToken = files.getContinuationToken();
        scriptProperties.setProperty('BACKLOG_DRIVE_CURSOR', continuationToken);
        Logger.log(`💾 Reached batch limit of ${MAX_FILES_PER_RUN} files. Saved continuation token to memory.`);
        return; 
      }

      let file = files.next();
      let fileId = file.getId();
      
      // 1. 🚨 DAILY OPTIMIZATION GUARD: Instantly skip files that are already residing in Firestore
      if (checkIfDocumentExists("knowledge_index", `${fileId}_chunk_0`)) {
        Logger.log(`⏩ Skipped "${file.getName()}": Already indexed.`);
        continue; 
      }

      Logger.log(`[File ${filesProcessedThisRun + 1}/${MAX_FILES_PER_RUN}] Evaluating new document: "${file.getName()}"`);
      
      let docUrl = `https://docs.google.com/document/d/${fileId}/edit`;
      let notesText = extractTextFromNotesTabViaREST(fileId);
      
      if (notesText && notesText.includes("A summary wasn't produced for this meeting")) {
        Logger.log(`⏩ Skipped "${file.getName()}": Empty placeholder.`);
        continue; 
      }
      
      if (notesText && notesText.trim().length > 0) {
        let chunks = bifrostTranscriptChunker(notesText);
        
        if (chunks.length > 0) {
          try {
            // Fetch embeddings from Gemini first
            let vectors = getBatchGeminiEmbeddings(chunks);

            // Wipe out historical positions if any old remnants accidentally exist
            Logger.log(`🧹 Purging old vector footprints for "${file.getName()}"...`);
            for (let historicalIdx = 0; historicalIdx < 20; historicalIdx++) {
              deleteFirestoreDocument("knowledge_index", `${fileId}_chunk_${historicalIdx}`);
            }

            // Write the new native Vector structures to Firestore
            for (let i = 0; i < chunks.length; i++) {
              let firestoreDocId = `${fileId}_chunk_${i}`;
              let documentPayload = {
                "source_type": "standup_transcript",
                "file_id": fileId,
                "doc_title": file.getName(),
                "doc_url": docUrl,
                "last_updated": file.getLastUpdated(),
                "text_chunk": chunks[i],
                "embedding_vector": vectors[i]
              };
              createFirestoreDocument("knowledge_index", firestoreDocId, documentPayload);
            }
            
            Logger.log(`--> Successfully synchronized ${chunks.length} chunks to Cloud Firestore.`);
            filesProcessedThisRun++;
            
            // TPM Cooldown Insurance
            Utilities.sleep(5000); 
            
          } catch (batchError) {
            Logger.log(`⚠️ Failed to embed/write chunks for "${file.getName()}": ${batchError.toString()}`);
            continue; 
          }
        }
      }
    }

    // 🎉 THE COMPLETION: Reset the backlog tracking cursor when the current sweep finishes cleanly
    scriptProperties.deleteProperty('BACKLOG_DRIVE_CURSOR');
    Logger.log("🎉 SUCCESS: Daily incremental indexing scan complete.");
    
  } catch (e) {
    Logger.log("Critical Ingestion System Error: " + e.toString());
  }
}

/**
 * ADVANCED NATIVE DOCS API READER
 */
function extractTextFromNotesTabViaREST(docId) {
  try {
    const docData = Docs.Documents.get(docId, { includeTabsContent: true });
    if (docData.tabs && docData.tabs.length > 0) {
      for (let i = 0; i < docData.tabs.length; i++) {
        let tab = docData.tabs[i];
        let title = tab.tabProperties && tab.tabProperties.title ? tab.tabProperties.title : "";
        if (title.toLowerCase().trim() === "notes") {
          return parseRestContentTree(tab.documentTab?.body);
        }
      }
      return parseRestContentTree(docData.tabs[0].documentTab?.body);
    }
    if (docData.body) return parseRestContentTree(docData.body);
    return null;
  } catch (e) {
    Logger.log(`Advanced Docs API Service exception for ID ${docId}: ${e.toString()}`);
    return null;
  }
}

/**
 * REST Response content parser matrix tree unpacker
 */
function parseRestContentTree(body) {
  let textOutput = "";
  if (!body || !body.content) return textOutput;
  body.content.forEach(element => {
    if (element.paragraph && element.paragraph.elements) {
      element.paragraph.elements.forEach(el => {
        if (el.textRun && el.textRun.content) textOutput += el.textRun.content;
      });
    } else if (element.table && element.table.tableRows) {
      element.table.tableRows.forEach(row => {
        if (row.tableCells) {
          row.tableCells.forEach(cell => {
            if (cell.content) {
              cell.content.forEach(cellElement => {
                if (cellElement.paragraph && cellElement.paragraph.elements) {
                  cellElement.paragraph.elements.forEach(el => {
                    if (el.textRun && el.textRun.content) textOutput += el.textRun.content + " ";
                  });
                }
              });
            }
          });
        }
      });
    }
  });
  return textOutput;
}

/**
 * STRUCTURAL TRANSCRIPT CHUNKER
 */
function bifrostTranscriptChunker(text) {
  const segments = text.split(/\n\s*\n/);
  const cleanChunks = [];
  let currentGroup = "";
  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i].trim();
    if (!segment) continue;
    if (segment.length >= 400) {
      if (currentGroup) {
        cleanChunks.push(currentGroup);
        currentGroup = "";
      }
      cleanChunks.push(segment);
    } else {
      if ((currentGroup + "\n\n" + segment).length > 1200) {
        cleanChunks.push(currentGroup);
        currentGroup = segment;
      } else {
        currentGroup = currentGroup ? currentGroup + "\n\n" + segment : segment;
      }
    }
  }
  if (currentGroup) cleanChunks.push(currentGroup);
  return cleanChunks;
}

/**
 * BATCH EMBEDDING GENERATOR
 */
function getBatchGeminiEmbeddings(chunks) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_API_KEY}`;
  const requests = chunks.map(chunk => {
    return {
      "model": "models/gemini-embedding-001",
      "content": { "parts": [{ "text": chunk }] },
      "output_dimensionality": 768
    };
  });
  const payload = { "requests": requests };
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true 
  };
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      if (responseCode === 200) {
        return JSON.parse(responseText).embeddings.map(e => e.values);
      }
      if (responseCode === 429 || responseCode === 503) {
        attempts++;
        if (attempts < maxAttempts) {
          Utilities.sleep(3000 * attempts);
          continue;
        }
      }
      throw new Error(`Batch API Status ${responseCode} -> Details: ${responseText}`);
    } catch (err) {
      attempts++;
      if (attempts >= maxAttempts) throw err;
      Utilities.sleep(2000);
    }
  }
}
